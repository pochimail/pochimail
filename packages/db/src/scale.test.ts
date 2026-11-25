import type { Category } from "@pochimail/classification/model/category";
import type { MessageId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { ACCOUNT_1, WS_A } from "@pochimail/testing/fixtures";
import { describe, expect, it } from "vitest";
import { overviewFiguresOver } from "./read-models/overview-figures.ts";
import { harness, mail, put, sender } from "./test-support/harness.ts";

describe("100,000 messages", () => {
  it("keeps indexed top-50, sender GROUP BY and Overview figures inside their budgets (guards a missing index or full scans)", {
    timeout: 120_000,
  }, async () => {
    // Guards: a missing index, a full scan, or per-message Overview figure reads at mailbox scale.
    const h = harness();
    const categories: Category[] = ["people", "newsletters", "promotions", "records"];
    const t0 = performance.now();
    const batch: IncomingMessage[] = [];
    for (let n = 1; n <= 100_000; n++)
      batch.push(
        mail(n, {
          from: sender(n % 2000),
          subject: `Update ${n % 500}`,
          threadId: `thr-${n}` as never,
        }),
      );
    await put(h, batch);
    const insertMs = performance.now() - t0;
    await h.uow.run(async (tx) => {
      for (let n = 1; n <= 100_000; n += 7)
        await tx.repositories.messages.setCategory(
          WS_A,
          `msg-${n}` as MessageId,
          categories[n % 4] as Category,
        );
      return ok(undefined);
    });

    // One warm-up run (page cache, prepared statements, JIT), then the median of RUNS: a shared Windows runner stalls single runs by 50 ms or more, a missing index slows every run.
    const RUNS = 5;
    const time = async <T>(run: () => T | Promise<T>) => {
      let value = await run();
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const s = performance.now();
        value = await run();
        samples.push(performance.now() - s);
      }
      samples.sort((a, b) => a - b);
      return { ms: samples[RUNS >> 1] as number, value };
    };
    const hash = h.storage.senderHasher.hash(ACCOUNT_1, sender(1));
    const top = await time(() =>
      h.uow.reads.messages.query(WS_A, { accountId: ACCOUNT_1, category: "people", limit: 50 }),
    );
    const bySender = await time(
      () =>
        h.storage.reader
          .prepare(
            "SELECT sender_hash, count(*) AS n FROM message WHERE workspace_id = ? AND account_id = ? GROUP BY sender_hash ORDER BY n DESC LIMIT 50",
          )
          .all(WS_A, ACCOUNT_1) as unknown[],
    );
    const statsTop = await time(() => h.uow.reads.senders.list(WS_A, ACCOUNT_1, { limit: 50 }));
    const hashed = await time(() =>
      h.uow.reads.messages.query(WS_A, {
        accountId: ACCOUNT_1,
        senderAddress: sender(1),
        limit: 50,
      }),
    );
    const figures = await time(() => overviewFiguresOver(h.storage.reader)(WS_A, [ACCOUNT_1]));
    const plan = h.storage.reader
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM message WHERE workspace_id = ? AND account_id = ? AND category = ? ORDER BY received_at DESC, id LIMIT 50",
      )
      .all(WS_A, ACCOUNT_1, "people") as { detail: string }[];
    const senderPlan = h.storage.reader
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM message WHERE workspace_id = ? AND account_id = ? AND sender_hash = ? ORDER BY received_at DESC, id LIMIT 50",
      )
      .all(WS_A, ACCOUNT_1, hash) as { detail: string }[];
    process.stderr.write(
      `[M2-03 budgets] insert 100k ${insertMs.toFixed(0)} ms; top-50 ${top.ms.toFixed(1)} ms; sender GROUP BY ${bySender.ms.toFixed(1)} ms; stats list ${statsTop.ms.toFixed(1)} ms; hashed sender ${hashed.ms.toFixed(1)} ms; overview figures ${figures.ms.toFixed(1)} ms\n`,
    );

    expect(unwrap(top.value).items).toHaveLength(50);
    expect(unwrap(hashed.value).items).toHaveLength(50);
    expect(plan.map((p) => p.detail).join(" ")).toContain("message_by_category");
    expect(senderPlan.map((p) => p.detail).join(" ")).toContain("message_by_sender_hash");
    expect(top.ms).toBeLessThan(100);
    // Guards: Overview figures regressing from one SQL aggregate to per-message reads at mailbox scale.
    expect(unwrap(figures.value)).toHaveLength(1);
    expect(figures.ms).toBeLessThan(2000);
    expect(bySender.ms).toBeLessThan(1500);
    expect(statsTop.ms).toBeLessThan(100);
    expect(hashed.ms).toBeLessThan(100);
  });
});
