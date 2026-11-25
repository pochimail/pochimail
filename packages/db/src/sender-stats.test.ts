import { unwrap } from "@pochimail/kernel/result";
import { ACCOUNT_1, WS_A } from "@pochimail/testing/fixtures";
import { describe, expect, it } from "vitest";
import { harness, mail, put, sender, T0 } from "./test-support/harness.ts";

describe("sender stats", () => {
  it("equal a full recount after a mixed upsert, replay, open and move sequence (guards drifting incremental counters)", async () => {
    const h = harness();
    const batch = [1, 2, 3, 4, 5, 6].map((n) => mail(n, { from: sender(n % 3) }));
    await put(h, batch);
    await put(h, batch); // replay: changes nothing
    await put(h, [mail(2, { from: sender(2), opened: true })]); // opened later
    await put(h, [mail(3, { from: sender(2) })]); // moved to another sender
    await put(h, [
      mail(4, { from: sender(1), receivedAt: new Date(T0 + 99 * 60_000).toISOString() }),
    ]);
    await put(h, [
      mail(7, { from: sender(1), opened: true }),
      mail(7, { from: sender(1), opened: false }),
    ]);

    const stats = unwrap(await h.uow.reads.senders.list(WS_A, ACCOUNT_1, { limit: 100 })).items;
    const recount = h.storage.reader
      .prepare(
        "SELECT sender_hash, count(*) AS n, sum(opened) AS opened, max(received_at) AS last FROM message GROUP BY sender_hash ORDER BY sender_hash",
      )
      .all() as { sender_hash: string; n: number; opened: number; last: string }[];
    expect(
      stats.map((s) => [
        h.storage.senderHasher.hash(ACCOUNT_1, s.address),
        s.messageCount,
        s.openedCount,
        s.lastMessageAt,
      ]),
    ).toEqual(recount.map((r) => [r.sender_hash, r.n, r.opened, r.last]));
    expect(stats.reduce((n, s) => n + s.messageCount, 0)).toBe(7);
  });

  it("count one sender once whatever the case of its address (guards a split sender after lowercasing moved to the hash)", async () => {
    const h = harness();
    await put(h, [
      mail(1, { from: "Sender@Example.COM" }),
      mail(2, { from: "sender@example.com" }),
    ]);
    const stats = unwrap(await h.uow.reads.senders.list(WS_A, ACCOUNT_1, { limit: 10 })).items;
    expect(stats.map((s) => s.messageCount)).toEqual([2]);
    const found = unwrap(await h.uow.reads.senders.get(WS_A, ACCOUNT_1, "SENDER@example.com"));
    expect(found.messageCount).toBe(2);
  });

  it("keep the VIP flag and replied count that the stats row already had (guards a re-sync wiping user knowledge)", async () => {
    const h = harness();
    await put(h, [mail(1, { from: sender(1) })]);
    const current = unwrap(await h.uow.reads.senders.get(WS_A, ACCOUNT_1, sender(1)));
    await h.uow.run(async (tx) =>
      tx.repositories.senders.upsert({ ...current, vip: true, repliedCount: 4 }),
    );
    await put(h, [mail(2, { from: sender(1) })]);
    const after = unwrap(await h.uow.reads.senders.get(WS_A, ACCOUNT_1, sender(1)));
    expect([after.messageCount, after.vip, after.repliedCount]).toEqual([2, true, 4]);
  });

  // Guards: re-ingesting a migrated message (empty sender hash) creating a phantom stats bucket for "".
  it("never keep a stats row for the empty sender hash of messages migrated to v6", async () => {
    const h = harness();
    await put(h, [mail(1, { from: sender(1) }), mail(2, { from: sender(1) })]);
    h.storage.writer.exec("UPDATE message SET sender_hash = ''; DELETE FROM sender_stats");
    await put(h, [mail(1, { from: sender(1) })]);
    const buckets = h.storage.reader
      .prepare("SELECT sender_hash, message_count FROM sender_stats")
      .all();
    expect(buckets).toEqual([
      { sender_hash: h.storage.senderHasher.hash(ACCOUNT_1, sender(1)), message_count: 1 },
    ]);
  });
});
