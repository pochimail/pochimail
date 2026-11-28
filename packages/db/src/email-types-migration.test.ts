// Guards: an upgrade that leaves a retired label in the database, where the strict type parser would fail every read, or that moves an email to the wrong type.
import { unwrap } from "@pochimail/kernel/result";
import Database from "better-sqlite3-multiple-ciphers";
import { expect, it } from "vitest";
import { MIGRATIONS, migrate } from "./migrator.ts";

const MOVES = [
  ["people", "personal"],
  ["records", "transactional"],
  ["purchases-travel", "transactional"],
  ["sign-ins-security", "transactional"],
  ["notifications", "notification"],
  ["newsletters", "newsletter"],
  ["promotions", "promotion"],
] as const;

it("moves every stored label and derived decision to its type and leaves the rest alone", () => {
  const db = new Database(":memory:");
  unwrap(migrate(db, MIGRATIONS.slice(0, 7)));
  const insertMessage = db.prepare(
    `INSERT INTO message (workspace_id, id, account_id, thread_id, sender_hash, received_at,
       has_list_unsubscribe, opened, topic_ids, category, ingest_seq)
     VALUES ('w', ?, 'a', 't', 'h', '2026-01-01T00:00:00.000Z', 0, 0, '[]', ?, ?)`,
  );
  const insertDerived = db.prepare(
    `INSERT INTO derived (workspace_id, message_id, account_id, category, reason_code, confidence, model_version, derived_at)
     VALUES ('w', ?, 'a', ?, '', 0.9, 'rules-1', '2026-01-01T00:00:00.000Z')`,
  );
  for (const [i, [old]] of MOVES.entries()) {
    insertMessage.run(`m-${i}`, old, i + 1);
    insertDerived.run(`m-${i}`, old);
  }
  insertMessage.run("m-new", "newsletter", 99);

  expect(unwrap(migrate(db))).toEqual({ from: 7, to: 8 });
  const labels = (table: string) =>
    db.prepare(`SELECT category FROM ${table} ORDER BY rowid`).all() as { category: string }[];
  expect(labels("message").map((r) => r.category)).toEqual([
    ...MOVES.map(([, now]) => now),
    "newsletter",
  ]);
  expect(labels("derived").map((r) => r.category)).toEqual(MOVES.map(([, now]) => now));
});
