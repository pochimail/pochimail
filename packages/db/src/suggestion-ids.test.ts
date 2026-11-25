// Guards: a suggestion keyed by the sender address or split by the display cache, so it changes or duplicates after a restart (ADR 0014).
import { PROTECTED_CATEGORIES } from "@pochimail/classification/model/category";
import { live, type SeedRow } from "@pochimail/cleanup/testing/samples";
import { ProposeSuggestions } from "@pochimail/cleanup/use-cases/propose-suggestions";
import { unwrap } from "@pochimail/kernel/result";
import { ACCOUNT_1, WS_A } from "@pochimail/testing/fixtures";
import { describe, expect, it } from "vitest";
import { createSenderHasher } from "./hmac-sender-hasher.ts";
import { guardSchema } from "./schema-guard.ts";
import { createSqliteUnitOfWork } from "./sqlite-unit-of-work.ts";
import { cleanupSeeder } from "./test-support/seeders.ts";
import { freshPath, key, open } from "./test-support/storage.ts";

const ADDRESS = "promo@example.com";
const promo = (): SeedRow => ({
  category: "promotions",
  message: { from: ADDRESS, hasListUnsubscribe: true },
  reason: "Weekly promo, never opened",
  confidence: 0.95,
});

/** A new connection to the same file: its display cache is empty, like after a restart. */
const session = (path: string) => {
  const storage = open(path, key(3));
  const { uow, outboxStore } = createSqliteUnitOfWork(storage);
  const committedOutbox = async () => unwrap(await outboxStore.pending(1000)).map((r) => r.entry);
  const propose = async () =>
    unwrap(
      await new ProposeSuggestions({
        uow,
        clock: { now: () => new Date("2026-01-02T00:00:00.000Z") },
        protectedLabels: PROTECTED_CATEGORIES,
      }).execute({ workspaceId: WS_A, accountId: ACCOUNT_1 }, live()),
    );
  return { storage, uow, seed: cleanupSeeder({ uow, committedOutbox }).seed, propose };
};

describe("suggestion ids across restarts", () => {
  it("one sender seen via the cache and via a placeholder gives one suggestion with a stable id", async () => {
    const path = freshPath();
    const before = session(path);
    await before.seed({ 3: promo() });

    // Messages 1 and 2 are ingested now, so their address is cached; message 3 comes from the file only.
    const after = session(path);
    await after.seed({ 1: promo(), 2: promo() });
    const hash = createSenderHasher(key(3)).hash(ACCOUNT_1, ADDRESS);
    const made = await after.propose();
    expect(made.map((s) => s.id)).toEqual([`sug:${ACCOUNT_1}:${hash}:unsubscribe`]);
    expect(made[0]?.recommendation.messageIds).toHaveLength(3);

    const restarted = session(path);
    expect(await restarted.propose()).toEqual([]);
    const pending = unwrap(await restarted.uow.reads.suggestions.listPending(WS_A, { limit: 10 }));
    expect(pending.items.map((s) => s.id)).toEqual([made[0]?.id]);
    expect(JSON.stringify(pending)).not.toContain("example.com");

    // The address is in no row of any table (suggestion, outbox event, job) and not in the file.
    const { storage } = restarted;
    const tables = storage.reader
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const rows = tables.flatMap(({ name }) =>
      storage.reader.prepare(`SELECT * FROM "${name}"`).all(),
    );
    expect(JSON.stringify(rows)).not.toContain(ADDRESS);
    expect(guardSchema(storage.writer).ok).toBe(true);
  });
});
