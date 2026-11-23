import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { SummarizeMailbox } from "@pochimail/cleanup/use-cases/summarize-mailbox";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import {
  generateMailbox,
  MAILBOX_SCALES,
  MOCK_DATASET,
} from "@pochimail/testing/fixture-mailbox/generator";
import { readMailbox } from "@pochimail/testing/fixture-mailbox/mailbox-reader";
import { describe, expect, it } from "vitest";
import { DEMO_SEED } from "../shared/demo.ts";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters, DEMO_HISTORY_CAPS } from "./fixture-adapters.ts";

// Slow on purpose (about a minute): it is the only check at the real mailbox size of brief §6. CI runs it with the rest.
describe("worker app at the brief §6 mock dataset size", () => {
  it("scanning the full fixture stores all 48,312 emails and the Overview figures are the fixture's own totals (guards a scan that drops mail, or figures that drift, at real mailbox size)", async () => {
    const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "full" });
    const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
    expect(mailbox.labels.totals.messages).toBe(MOCK_DATASET.totalMessages);
    expect(MAILBOX_SCALES.full).toBe(MOCK_DATASET.totalMessages);

    let jobs = 0;
    const adapters = await createFixtureAdapters({
      scale: "full",
      timer: createFakeTimer(),
      logger: createLogger({ sink: { write: () => {} } }),
      deviceName: () => "Mac",
      classifier: createGroundTruthClassifier(labels),
      newJobId: () => `job-${++jobs}`,
      pageSize: 1_000,
    });
    const app = createWorkerApp(adapters);
    for (const account of mailbox.accounts)
      await app.handlers.procedures["scan.start"]?.({ accountId: account.id });
    await app.idle();

    const overview = await app.handlers.procedures["overview.get"]?.({});
    expect(overview?.scanned).toBe(MOCK_DATASET.totalMessages);

    // Category totals are the ones on the reference screens.
    const summary = await new SummarizeMailbox({
      uow: adapters.uow,
      clock: adapters.clock,
    }).execute({
      workspaceId: adapters.workspaceId,
      accountIds: mailbox.accounts.map((a) => a.id as never),
    });
    expect(summary.ok && summary.value.categories).toEqual(MOCK_DATASET.categories);
    // The Overview's cleanable counts are those category totals. The 7 waiting / 3 deadlines / 12 important figures are NOT
    // asserted: the detectors do not reach them yet (known M3 gap, docs/status.md).
    for (const { category, count } of overview?.cleanable ?? [])
      expect(count).toBe(MOCK_DATASET.categories[category]);

    // #114: attachment totals come from the scan, action totals from the demo history,
    // and the archived markers survive the scan's re-store of the same messages.
    const figures = overview?.figures;
    expect(figures?.savedCount).toBe(MOCK_DATASET.documents);
    expect(figures?.savedSize).toBe(mailbox.labels.totals.attachmentBytes);
    expect(figures?.archived).toBe(DEMO_HISTORY_CAPS.archived);
    expect(figures?.unsubscribed).toBe(DEMO_HISTORY_CAPS.unsubscribed);
    // Deletable size is exactly the oldest documents the demo history moved to Trash.
    const [firstAccount] = mailbox.accounts;
    if (!firstAccount) throw new Error("generator returned no account");
    const documents = new Set(
      mailbox.labels.messages
        .filter((l) => l.signals.includes("has-document"))
        .map((l) => l.messageId),
    );
    const trashed = readMailbox(firstAccount.mbox, {
      accountId: firstAccount.id,
      workspaceId: mailbox.workspaceId,
    })
      .filter((m) => documents.has(m.message.id))
      .slice(0, DEMO_HISTORY_CAPS.trashed);
    expect(trashed).toHaveLength(DEMO_HISTORY_CAPS.trashed);
    expect(figures?.deletableSize).toBe(trashed.reduce((sum, m) => sum + (m.message.size ?? 0), 0));
    expect(figures?.deletableSize).toBeGreaterThan(0);
    expect(figures?.totalSize).toBeGreaterThan(figures?.savedSize ?? 0);
  }, 600_000);
});
