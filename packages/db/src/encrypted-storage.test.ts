import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import Database from "better-sqlite3-multiple-ciphers";
import { describe, expect, it } from "vitest";
import { DisplayFieldsCache } from "./mailbox/display-fields-cache.ts";
import { createMessageRepository } from "./mailbox/message-repository.ts";
import { MIGRATIONS, migrate } from "./migrator.ts";
import { isPlainSqliteFile, openStorage } from "./open-storage.ts";
import { overviewFiguresOver } from "./read-models/overview-figures.ts";
import { freshPath, key, open } from "./test-support/storage.ts";

describe("encrypted storage", () => {
  it("rejects a wrong key and leaves no plain SQLite header (guards an unencrypted or key-ignoring database)", () => {
    const path = freshPath();
    open(path, key(1)).close();
    expect(isPlainSqliteFile(path)).toBe(false);
    const wrong = openStorage(path, key(2));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.error.code).toBe("storage.failed");
      expect(wrong.error.message).toBe("Could not open the database (wrong key or damaged file)");
    }
    expect(open(path, key(1))).toBeDefined();
  });

  it("refuses a key that is not 32 bytes (guards silently weak keys)", () => {
    expect(openStorage(freshPath(), Buffer.alloc(16, 1)).ok).toBe(false);
  });
});

describe("encrypted storage refusals", () => {
  it("refuses a plain unencrypted SQLite file (guards silently reading or adopting a plaintext database)", () => {
    const path = freshPath();
    const plain = new Database(path);
    plain.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1)");
    plain.close();
    expect(openStorage(path, key(1)).ok).toBe(false);
  });

  it("never puts the key or its hex in an error message or cause (guards key leaks into logs)", () => {
    const path = freshPath();
    open(path, key(1)).close();
    const secret = key(7);
    const failure = openStorage(path, secret);
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    const text = `${failure.error.message} ${failure.error.stack} ${String(failure.error.cause)}`;
    expect(text).not.toContain(secret.toString("hex"));
    expect(text).not.toContain(key(1).toString("hex"));
    const short = openStorage(freshPath(), Buffer.alloc(16, 9));
    if (!short.ok) expect(short.error.message).not.toContain(Buffer.alloc(16, 9).toString("hex"));
  });
});

describe("migrator", () => {
  it("running migrations twice changes nothing (guards a re-run wiping or duplicating tables)", () => {
    const path = freshPath();
    const first = open(path);
    first.writer
      .prepare(
        "INSERT INTO digest_state (workspace_id, account_id, last_digest_at) VALUES ('w', 'a', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    expect(unwrap(migrate(first.writer))).toEqual({ from: 7, to: 7 });
    first.close();
    const again = open(path);
    expect(again.writer.prepare("SELECT count(*) AS n FROM digest_state").get()).toEqual({ n: 1 });
  });

  // Guards: an upgrade wiping rows stored before the figures columns existed, or guessing their facts (#114).
  it("opens a version 4 database, keeps its rows and leaves the new facts unknown", () => {
    const path = freshPath();
    const old = new Database(path);
    old.pragma("cipher='sqlcipher'");
    old.pragma(`key="x'${key(1).toString("hex")}'"`);
    expect(unwrap(migrate(old, MIGRATIONS.slice(0, 4)))).toEqual({ from: 0, to: 4 });
    old
      .prepare(
        `INSERT INTO message (workspace_id, id, account_id, thread_id, sender, recipients, subject, snippet,
         received_at, has_list_unsubscribe, opened, size, topic_ids, category, ingest_seq)
       VALUES ('w', 'm-old', 'a', 't', 'sender@example.com', '["owner@example.com"]', 'Subject', 'Snippet',
         '2026-01-01T00:00:00.000Z', 0, 0, 1234, '[]', 'notifications', 1)`,
      )
      .run();
    old.close();
    const storage = open(path);
    expect(storage.writer.pragma("user_version", { simple: true })).toBe(7);
    const stored = unwrap(
      createMessageRepository(storage.writer, {
        cache: new DisplayFieldsCache(),
        senderHasher: storage.senderHasher,
      }).get("w" as WorkspaceId, "m-old" as MessageId),
    );
    expect(stored.size).toBe(1234);
    expect(stored.subject).toBe("");
    expect(stored.from).not.toContain("sender@example.com");
    expect(stored.savedCount).toBeUndefined();
    expect(stored.savedSize).toBeUndefined();
    expect(stored.archived).toBeUndefined();
    // Unknown facts add nothing; only the size the old row already had is counted.
    expect(
      unwrap(overviewFiguresOver(storage.reader)("w" as WorkspaceId, ["a" as AccountId])),
    ).toEqual([
      {
        accountId: "a",
        archived: 0,
        savedCount: 0,
        savedSize: 0,
        deletableSize: 0,
        unsubscribed: 0,
        totalSize: 1234,
      },
    ]);
  });

  it("refuses a database written by a newer build (guards downgrade corrupting a newer schema)", () => {
    const path = freshPath();
    const storage = open(path);
    storage.writer.pragma("user_version = 99");
    storage.close();
    const reopened = openStorage(path, key(1));
    expect(reopened.ok).toBe(false);
  });
});
