import { ok, unwrap } from "@pochimail/kernel/result";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { makeIncomingMessage } from "@pochimail/testing/fixtures";
import { expect } from "vitest";
import { createSqliteUnitOfWork } from "../sqlite-unit-of-work.ts";
import { key, open } from "./storage.ts";

const TABLE_KEYS: Record<string, string> = {
  account: "accounts",
  message: "messages",
  thread: "threads",
  sender_stats: "senders",
  suggestion: "suggestions",
  signal: "signals",
  action_log: "actionLog",
  cursor: "cursors",
  topic: "topics",
  digest_state: "digestState",
};

/** Every committed row of every table and the outbox, as plain data. */
export function harness() {
  const storage = open(undefined, key(3));
  const sqlite = createSqliteUnitOfWork(storage);
  const committedOutbox = async () =>
    unwrap(await sqlite.outboxStore.pending(100_000)).map((r) => r.entry);
  const snapshot = async () => {
    const tables = storage.reader
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('outbox', 'job')",
      )
      .all() as { name: string }[];
    const out: Record<string, unknown> = {};
    for (const { name } of tables)
      out[TABLE_KEYS[name] ?? name] = storage.reader.prepare(`SELECT * FROM "${name}"`).all();
    out.outbox = await committedOutbox();
    return out;
  };
  return { storage, ...sqlite, committedOutbox, snapshot };
}
export const uowHarness = () => {
  const h = harness();
  return { uow: h.uow, committedOutbox: h.committedOutbox };
};

export const T0 = Date.UTC(2026, 0, 1);
export const sender = (n: number) => `sender${n}@example.com`;
export const mail = (n: number, over: Partial<IncomingMessage> = {}) =>
  makeIncomingMessage(n, { receivedAt: new Date(T0 + n * 60_000).toISOString(), ...over });

export async function put(h: ReturnType<typeof harness>, messages: IncomingMessage[]) {
  const r = await h.uow.run(async (tx) => {
    for (let i = 0; i < messages.length; i += 1000)
      unwrap(await tx.repositories.messages.upsertMany(messages.slice(i, i + 1000)));
    return ok(undefined);
  });
  expect(r.ok).toBe(true);
}
