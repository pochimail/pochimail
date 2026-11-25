import {
  CATEGORIES,
  type Category,
  categoryOf,
  SIGNAL_KINDS,
  type SignalKind,
} from "@pochimail/classification/model/category";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { ClassifyBatch } from "@pochimail/classification/use-cases/classify-batch";
import { DetectSignals } from "@pochimail/classification/use-cases/detect-signals";
import { EvaluateSuspicious } from "@pochimail/classification/use-cases/evaluate-suspicious";
import { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import type { Message } from "@pochimail/mailbox/model/message";
import { RunIncrementalSync } from "@pochimail/workflows/use-cases/run-incremental-sync";
import { createFakeClock } from "../fake-clock.ts";
import { createFixtureMailProvider } from "../fixture-mailbox/fixture-mail-provider.ts";
import { FIXTURE_NOW, type GeneratedMailbox } from "../fixture-mailbox/generator.ts";
import { createInMemoryUnitOfWork } from "../in-memory-store.ts";
import { metricsFromCounts, scoreMultiLabel, scoreSingleLabel } from "./metrics.ts";
import { type EvalReport, evalReportSchema } from "./report.ts";
import { seedContext } from "./seed-context.ts";

const BATCH = 100;
const live = () => new AbortController().signal;

export interface RunEvalOptions {
  /** Any `Classifier`: the ground-truth stub today, the real one in M3. */
  readonly classifier: Classifier;
  readonly mailbox: GeneratedMailbox;
}

/**
 * Runs the real pipeline over a fixture mailbox (sync, then ClassifyBatch with `classifier`, then
 * DetectSignals) in memory and scores the result against the fixture's ground-truth labels.
 * Metadata only: bodies are never read or stored (D11), and the report holds counts and ratios,
 * never a subject, address or snippet.
 */
export async function runEval({ classifier, mailbox }: RunEvalOptions): Promise<EvalReport> {
  const workspaceId = unwrap(WorkspaceId(mailbox.workspaceId));
  const clock = createFakeClock(new Date(FIXTURE_NOW));
  const { uow } = createInMemoryUnitOfWork();
  const classify = new ClassifyBatch({ uow, classifier, clock });
  const detect = new DetectSignals({ uow, clock });

  const expected = new Map(mailbox.labels.messages.map((l) => [l.messageId, l]));
  const predictedCategory = new Map<string, Category>();
  const predictedSignals = new Map<string, SignalKind[]>();
  const predictedSuspicious = new Set<string>();
  let unclassified = 0;

  for (const account of mailbox.accounts) {
    const accountId = unwrap(AccountId(account.id));
    unwrap(
      await uow.run(
        (tx) =>
          tx.repositories.accounts.save({
            schemaVersion: 1,
            id: accountId,
            workspaceId,
            provider: account.provider,
            address: account.address,
            connectedAt: clock.now().toISOString(),
            grantedScopes: [],
          }),
        live(),
      ),
    );
    const provider = createFixtureMailProvider({
      mbox: account.mbox,
      accountId: account.id,
      workspaceId: mailbox.workspaceId,
    });
    unwrap(
      await new RunIncrementalSync({ uow, provider, clock }).execute(
        { workspaceId, accountId },
        live(),
      ),
    );

    const messages = await readAll(uow.reads.messages, workspaceId, accountId);
    await seedContext(uow, messages, account.address);

    const ids = messages.map((m) => m.id).sort();
    for (let i = 0; i < ids.length; i += BATCH) {
      const report = unwrap(
        await classify.execute({ workspaceId, messageIds: ids.slice(i, i + BATCH) }, live()),
      );
      unclassified += report.unclassified.length;
      for (const id of report.unclassified) predictedCategory.delete(id);
      const unanswered = new Set<string>(report.unclassified);
      for (const id of ids.slice(i, i + BATCH)) {
        if (unanswered.has(id)) continue;
        const stored = unwrap(await uow.reads.messages.get(workspaceId, unwrap(MessageId(id))));
        predictedCategory.set(id, categoryOf(stored));
      }
    }
    const signals = unwrap(
      await detect.execute(
        { workspaceId, accountId, messageIds: messages.map((m) => m.id) },
        live(),
      ),
    );
    for (const s of signals) {
      predictedSignals.set(s.messageId, [...(predictedSignals.get(s.messageId) ?? []), s.kind]);
    }
    const flagged = unwrap(
      await new EvaluateSuspicious({ signalFacts: uow.reads.signalFacts }).execute({
        workspaceId,
        accountId,
        messageIds: messages.map((m) => m.id),
      }),
    );
    for (const f of flagged) predictedSuspicious.add(f.messageId);
  }

  const labelled = [...expected.values()];
  const categories = scoreSingleLabel(
    CATEGORIES,
    labelled.map((l) => ({ expected: l.category, predicted: predictedCategory.get(l.messageId) })),
  );
  const signals = scoreMultiLabel(
    SIGNAL_KINDS,
    labelled.map((l) => ({
      expected: l.signals,
      predicted: predictedSignals.get(l.messageId) ?? [],
    })),
  );
  const suspicious = metricsFromCounts({
    truePositives: labelled.filter((l) => l.suspicious && predictedSuspicious.has(l.messageId))
      .length,
    falsePositives: labelled.filter((l) => !l.suspicious && predictedSuspicious.has(l.messageId))
      .length,
    falseNegatives: labelled.filter((l) => l.suspicious && !predictedSuspicious.has(l.messageId))
      .length,
  });
  return evalReportSchema.parse({
    schemaVersion: 1,
    fixture: { seed: mailbox.labels.seed, scale: mailbox.labels.scale, messages: labelled.length },
    unclassified,
    categoryAccuracy: categories.accuracy,
    categories: categories.perClass,
    signals,
    suspicious,
  });
}

type Reads = ReturnType<typeof createInMemoryUnitOfWork>["uow"]["reads"]["messages"];

async function readAll(
  reads: Reads,
  workspaceId: WorkspaceId,
  accountId: AccountId,
): Promise<Message[]> {
  const out: Message[] = [];
  let cursor: string | undefined;
  do {
    const page = unwrap(
      await reads.query(workspaceId, { accountId, limit: 500, ...(cursor ? { cursor } : {}) }),
    );
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}
