import { existsSync, readFileSync } from "node:fs";
import { makeDerived } from "@pochimail/classification/testing/samples";
import { makeSignal } from "@pochimail/classification/testing/signal-repository-contract";
import { makeSuggestion } from "@pochimail/cleanup/testing/samples";
import type { MessageId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import {
  ACCOUNT_1,
  makeIncomingMessage,
  makeSender,
  makeThread,
  WS_A,
} from "@pochimail/testing/fixtures";
import Database from "better-sqlite3-multiple-ciphers";
import { describe, expect, it } from "vitest";
import { createSenderHasher } from "./hmac-sender-hasher.ts";
import { DisplayFieldsCache } from "./mailbox/display-fields-cache.ts";
import { MIGRATIONS, migrate } from "./migrator.ts";
import { ALLOWED_COLUMNS, guardSchema } from "./schema-guard.ts";
import { createSqliteCore } from "./sqlite-repositories.ts";
import { createSqliteUnitOfWork } from "./sqlite-unit-of-work.ts";
import { freshPath, key, open } from "./test-support/storage.ts";

// Invented markers: if any of these reaches SQL or the file, private mail data is at rest.
const MARKERS = [
  "MARKER_SUBJECT_7f3a",
  "MARKER_SNIPPET_7f3a",
  "MARKER_FROM_7f3a@example.com",
  "MARKER_TO_7f3a@example.com",
  "MARKER_SUSPICIOUS_7f3a",
  "MARKER_THREAD_SUBJECT_7f3a",
  "MARKER_DERIVED_REASON_7f3a",
  "MARKER_DERIVED_SNIPPET_7f3a",
  "MARKER_TEMPLATE_7f3a",
  "MARKER_EMBEDDING_7f3a",
  "MARKER_SIGNAL_REASON_7f3a",
  "MARKER_SUGGESTION_REASON_7f3a",
  "MARKER_LABEL_7f3a",
  "MARKER_SENDER_STATS_7f3a@example.com",
] as const;

// Invented v5 values: each sits in a column that v6 drops or blanks.
const OLD = {
  subject: "Old subject",
  snippet: "Old snippet",
  address: "sender@example.com",
  owner: "owner@example.com",
  reason: "Old reason",
  thread: "Old thread",
  derived: "Old derived reason",
  signal: "Old signal reason",
  suggestion: "Old suggestion reason",
} as const;

function seedV5(db: Database.Database) {
  unwrap(migrate(db, MIGRATIONS.slice(0, 5)));
  db.exec(`
    INSERT INTO message (workspace_id, id, account_id, thread_id, sender, recipients, subject, snippet,
      received_at, has_list_unsubscribe, opened, size, topic_ids, suspicious_reasons, suspicious_confidence, category, ingest_seq)
    VALUES ('${WS_A}', 'm-old', 'a', 't', '${OLD.address}', '["${OLD.owner}"]', '${OLD.subject}',
      '${OLD.snippet}', '2026-01-01T00:00:00.000Z', 0, 0, NULL, '[]', '["${OLD.reason}"]', 0.5, 'records', 1);
    INSERT INTO thread (workspace_id, id, account_id, subject, message_ids, last_message_at)
      VALUES ('${WS_A}', 't', 'a', '${OLD.thread}', '["m-old"]', '2026-01-01T00:00:00.000Z');
    INSERT INTO derived (workspace_id, message_id, account_id, category, reason, confidence, model_version, snippet, derived_at)
      VALUES ('${WS_A}', 'm-old', 'a', 'records', '${OLD.derived}', 0.9, 'rules-1', '${OLD.snippet}', '2026-01-01T00:00:00.000Z');
    INSERT INTO signal (workspace_id, message_id, kind, confidence, detected_at, reason)
      VALUES ('${WS_A}', 'm-old', 'has-document', 0.9, '2026-01-01T00:00:00.000Z', '${OLD.signal}');
    INSERT INTO sender_stats (workspace_id, account_id, address, message_count, opened_count, replied_count, last_message_at, vip)
      VALUES ('${WS_A}', 'a', '${OLD.address}', 1, 0, 0, '2026-01-01T00:00:00.000Z', 0);
    INSERT INTO suggestion (workspace_id, id, account_id, state, confidence, created_at, command, reasons)
      VALUES ('${WS_A}', 's-old', 'a', 'pending', 0.9, '2026-01-01T00:00:00.000Z', '{"kind":"archive","messageIds":["m-old"]}', '["${OLD.suggestion}"]');
  `);
}

/** Bytes of the main file and its WAL, read while the database is still open. */
function fileBytes(path: string): string {
  const wal = `${path}-wal`;
  return (
    readFileSync(path).toString("latin1") +
    (existsSync(wal) ? readFileSync(wal).toString("latin1") : "")
  );
}

function plainWalV5(): { path: string; db: Database.Database } {
  const path = freshPath();
  const db = new Database(path, { timeout: 50 });
  db.pragma("journal_mode = wal");
  seedV5(db);
  // Frames move into the main file but stay in the WAL: both hold the clear text before v6.
  db.pragma("wal_checkpoint(FULL)");
  return { path, db };
}

describe("ADR 0014: nothing private reaches SQLite", () => {
  // Guards: a column outside the allow-list being added to the schema.
  it("the schema guard refuses an added non-allow-listed column", () => {
    const storage = open();
    storage.writer.exec("ALTER TABLE message ADD COLUMN leaked TEXT");
    const guarded = guardSchema(storage.writer);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.error.message).toContain("message.leaked");
  });

  // Guards: a repository writing a subject, address, snippet, reason or label into a row or a file.
  it("stores only hashes and codes: no fixture value appears in any row or in the file bytes", async () => {
    const path = freshPath();
    const storage = open(path, key(3));
    const { uow } = createSqliteUnitOfWork(storage);
    const message = makeIncomingMessage(1, {
      subject: MARKERS[0],
      snippet: MARKERS[1],
      from: MARKERS[2],
      to: [MARKERS[3]],
      suspicious: { reasons: [MARKERS[4]], confidence: 0.7 },
    });
    const r = await uow.run(async (tx) => {
      unwrap(await tx.repositories.messages.upsertMany([message]));
      unwrap(await tx.repositories.threads.upsert(makeThread({ subject: MARKERS[5] })));
      unwrap(
        await tx.repositories.derived.save(
          makeDerived(1, {
            reason: MARKERS[6],
            snippet: MARKERS[7],
            templateHash: MARKERS[8],
            embeddingRef: MARKERS[9],
          }),
        ),
      );
      unwrap(
        await tx.repositories.signals.replaceForMessages(
          WS_A,
          ["msg-1" as MessageId],
          [makeSignal(1, { reason: MARKERS[10] })],
        ),
      );
      unwrap(
        await tx.repositories.suggestions.save(
          makeSuggestion({
            reasons: [MARKERS[11]],
            recommendation: {
              kind: "archive",
              messageIds: ["msg-1" as MessageId],
              label: MARKERS[12],
            },
          }),
        ),
      );
      unwrap(await tx.repositories.senders.upsert(makeSender({ address: MARKERS[13] })));
      return ok(undefined);
    });
    expect(r.ok).toBe(true);

    const tables = storage.reader
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const rows = tables.flatMap(({ name }) =>
      storage.reader.prepare(`SELECT * FROM "${name}"`).all(),
    );
    const database = JSON.stringify(rows);
    const file = readFileSync(path, "utf8");
    const wal = `${path}-wal`;
    const bytes = file + (existsSync(wal) ? readFileSync(wal, "utf8") : "");
    for (const marker of MARKERS) {
      expect(database).not.toContain(marker);
      expect(bytes).not.toContain(marker);
    }
    const hash = createSenderHasher(key(3)).hash(ACCOUNT_1, MARKERS[2]);
    expect(storage.reader.prepare("SELECT sender_hash FROM message").get()).toEqual({
      sender_hash: hash,
    });
    expect(
      storage.reader.prepare("SELECT reason_code FROM derived WHERE message_id = 'msg-1'").get(),
    ).not.toEqual({ reason_code: MARKERS[6] });

    // A restart with no cache must not pass the stored hex code off as the rule's reason text.
    const fresh = createSqliteCore(storage.reader, {
      cache: new DisplayFieldsCache(),
      senderHasher: storage.senderHasher,
    });
    const [signal] = unwrap(fresh.signals.listForMessages(WS_A, ["msg-1" as MessageId]));
    expect(signal?.kind).toBe("needs-reply");
    expect(signal?.reason).toBeUndefined();
  });

  // Guards: v6 leaving clear text in a freed page or a WAL frame. The file is plain SQLite so the byte scan can fail.
  it("the v6 scrub removes pre-v6 clear text from the main file and the WAL", () => {
    const { path, db } = plainWalV5();
    const before = fileBytes(path);
    for (const marker of Object.values(OLD)) expect(before).toContain(marker);
    unwrap(migrate(db));
    const after = fileBytes(path);
    for (const marker of Object.values(OLD)) expect(after).not.toContain(marker);
    db.close();
  });

  // Guards: the byte scan above passing because it cannot see anything.
  it("the same scan finds the clear text when the migration has no scrub", () => {
    const { path, db } = plainWalV5();
    unwrap(
      migrate(
        db,
        MIGRATIONS.map(({ scrub: _scrub, ...m }) => m),
      ),
    );
    const after = fileBytes(path);
    expect(Object.values(OLD).some((marker) => after.includes(marker))).toBe(true);
    db.close();
  });

  // Guards: a scrub that failed after v6 committed never being retried, or reported as a failed migration.
  it("retries the scrub on the next open and reports its failure as a cleanup failure", () => {
    const { path, db } = plainWalV5();
    const reader = new Database(path);
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) FROM message").get(); // a read snapshot blocks the WAL truncation
    const failed = migrate(db);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toBe("Database cleanup after migration failed");
    expect(db.pragma("user_version", { simple: true })).toBe(7);
    reader.close();

    expect(unwrap(migrate(db))).toEqual({ from: 7, to: 7 });
    for (const marker of Object.values(OLD)) expect(fileBytes(path)).not.toContain(marker);
    db.close();
  });

  // Guards: an upgrade leaving FTS5, clear-text senders or free-text reasons in a row.
  it("a v5 database upgrades to v6 with FTS5 gone and clear-text values blanked", () => {
    const path = freshPath();
    const old = new Database(path);
    old.pragma("cipher='sqlcipher'");
    old.pragma(`key="x'${key(1).toString("hex")}'"`);
    seedV5(old);
    old.close();

    const storage = open(path);
    expect(storage.writer.pragma("user_version", { simple: true })).toBe(7);
    const objects = storage.writer
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'message_search%' OR name LIKE 'signal_search%'",
      )
      .all() as { name: string }[];
    expect(objects.map((o) => o.name)).toEqual([]);
    expect(guardSchema(storage.writer).ok).toBe(true);
    expect(storage.reader.prepare("SELECT sender_hash FROM message").get()).toEqual({
      sender_hash: "",
    });
    expect(storage.reader.prepare("SELECT reason_code FROM derived").get()).toEqual({
      reason_code: "",
    });
    expect(storage.reader.prepare("SELECT reason_code FROM signal").get()).toEqual({
      reason_code: "",
    });
    expect(storage.reader.prepare("SELECT reason_codes FROM suggestion").get()).toEqual({
      reason_codes: "[]",
    });
    // Migrated messages have sender_hash = '', so no per-sender stats row can point at them.
    expect(storage.reader.prepare("SELECT count(*) AS n FROM sender_stats").get()).toEqual({
      n: 0,
    });

    const rows = JSON.stringify(storage.reader.prepare("SELECT * FROM message").all());
    for (const marker of Object.values(OLD)) expect(rows).not.toContain(marker);

    // A restart has no private-field cache: an empty reason_code must not become a fake reason.
    const fresh = createSqliteCore(storage.reader, {
      cache: new DisplayFieldsCache(),
      senderHasher: storage.senderHasher,
    });
    const [migrated] = unwrap(fresh.signals.listForMessages(WS_A, ["m-old" as MessageId]));
    expect(migrated?.kind).toBe("has-document");
    expect(migrated?.reason).toBeUndefined();
  });

  // Guards: an allow-list entry that lets a private field back into a table.
  it("the allow-list contains no content field name", () => {
    const forbidden = new Set([
      "body",
      "subject",
      "snippet",
      "sender",
      "recipients",
      "address",
      "reason",
      "reasons",
      "embedding_ref",
      "embedding",
      "vector",
      "template_hash",
      "content_hash",
      "message_search",
      "attachment_name",
      "unsubscribe_url",
    ]);
    expect(ALLOWED_COLUMNS.message).not.toContain("address");
    expect(
      Object.entries(ALLOWED_COLUMNS).flatMap(([table, columns]) => [
        ...(forbidden.has(table) ? [table] : []),
        ...columns.filter((column) => forbidden.has(column) && table !== "account"),
      ]),
    ).toEqual([]);
  });
});
