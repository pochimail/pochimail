import type { Account } from "@pochimail/accounts/model/account";
import { ActionId } from "@pochimail/actions/ids";
import type { Action } from "@pochimail/actions/model/action";
import { ApplyAction, type ApplyOutcome } from "@pochimail/actions/use-cases/apply-action";
import { UndoAction, type UndoOutcome } from "@pochimail/actions/use-cases/undo-action";
import {
  EMAIL_TYPES,
  type EmailType,
  emailTypeOf,
} from "@pochimail/classification/model/email-type";
import { SIGNAL_KINDS, type SignalKind } from "@pochimail/classification/model/signal";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { ProposeSuggestions } from "@pochimail/cleanup/use-cases/propose-suggestions";
import {
  type MailboxSummary,
  SummarizeMailbox,
} from "@pochimail/cleanup/use-cases/summarize-mailbox";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { runEval } from "@pochimail/testing/eval/harness";
import type { EvalReport } from "@pochimail/testing/eval/report";
import { seedContext } from "@pochimail/testing/eval/seed-context";
import { createFakeClock } from "@pochimail/testing/fake-clock";
import {
  createFixtureMailProvider,
  type FixtureMailProvider,
} from "@pochimail/testing/fixture-mailbox/fixture-mail-provider";
import {
  FIXTURE_NOW,
  generateMailbox,
  type MailboxScale,
} from "@pochimail/testing/fixture-mailbox/generator";
import { readMailbox } from "@pochimail/testing/fixture-mailbox/mailbox-reader";
import { createInMemoryJobQueue } from "@pochimail/testing/in-memory-job-queue";
import { createInMemoryUnitOfWork } from "@pochimail/testing/in-memory-store";
import { createScanPipeline } from "@pochimail/workflows/jobs/scan-pipeline";
import type { WorkflowUnitOfWork as UnitOfWork } from "@pochimail/workflows/ports/unit-of-work";

/** Same seed as the eval gate, so the demo and the eval describe the same mailbox. */
export const SEED = 20261117;
const PAGE_SIZE = 100;

export interface ScenarioOptions {
  readonly scale: MailboxScale;
  /** Pause the scan after this many fetched batches, then resume it (proves pause/resume). */
  readonly pauseAfterBatches?: number;
  /** Test seam: wraps the classifier (e.g. to make a stage fail). */
  readonly wrapClassifier?: (classifier: Classifier) => Classifier;
}

/** The cleanup summary with every category and signal kind present (0 when none), as the report prints it. */
type ScenarioSummary = Omit<MailboxSummary, "categories" | "signals"> & {
  readonly categories: Readonly<Record<EmailType, number>>;
  readonly signals: Readonly<Record<SignalKind, number>>;
};

export interface ScenarioResult {
  readonly scale: MailboxScale;
  readonly scan: {
    readonly batches: number;
    readonly pauses: number;
    readonly deferred: number;
    readonly deadLettered: number;
  };
  readonly summary: ScenarioSummary;
  /** What was proposed; every suggestion is approved as an archive of its messages. */
  readonly suggestions: { readonly archive: number; readonly unsubscribe: number };
  readonly applied: readonly ApplyOutcome[];
  readonly undone: readonly UndoOutcome[];
  /** Apply really changed the mailbox (guards a vacuous undo check). */
  readonly changedByApply: boolean;
  /** The mailbox as the provider sees it is identical before apply and after undo. */
  readonly mailboxRestored: boolean;
  readonly eval: EvalReport;
}

const live = () => new AbortController().signal;

/**
 * Composition root of the M1 demo: fixture mailbox + in-memory adapters + domain use cases and workflows.
 * Wiring only; every decision is made by the domain packages and `packages/workflows`.
 */
export async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const mailbox = generateMailbox({ seed: SEED, scale: options.scale });
  const labels = new Map<string, EmailType>(
    mailbox.labels.messages.map((l) => [l.messageId, l.category]),
  );
  const truth = createGroundTruthClassifier(labels);
  const classifier = options.wrapClassifier?.(truth) ?? truth;
  const workspaceId = unwrap(WorkspaceId(mailbox.workspaceId));
  const clock = createFakeClock(new Date(FIXTURE_NOW));
  const { uow } = createInMemoryUnitOfWork();
  const queue = createInMemoryJobQueue(clock);
  let next = 0;
  const ids: IdGenerator = { next: (prefix) => `${prefix}_${++next}` };

  const providers = new Map<AccountId, FixtureMailProvider>();
  let batches = 0;
  let pauses = 0;
  let deferred = 0;
  let deadLettered = 0;

  // 1. sync -> classify -> signals, as one pausable pipeline per account.
  for (const fixture of mailbox.accounts) {
    const accountId = unwrap(AccountId(fixture.id));
    const account: Account = {
      schemaVersion: 1,
      id: accountId,
      workspaceId,
      provider: fixture.provider,
      address: fixture.address,
      connectedAt: clock.now().toISOString(),
      grantedScopes: [],
    };
    unwrap(await uow.run((tx) => tx.repositories.accounts.save(account), live()));
    const fixtureProvider = createFixtureMailProvider({
      mbox: fixture.mbox,
      accountId: fixture.id,
      workspaceId: mailbox.workspaceId,
      pageSize: PAGE_SIZE,
    });
    providers.set(accountId, fixtureProvider);
    // Threads and sender stats are not produced by sync yet (M2): seed them from the fixture.
    await seedContext(
      uow,
      readMailbox(fixture.mbox, { accountId: fixture.id, workspaceId: mailbox.workspaceId }).map(
        (m) => m.message,
      ),
      fixture.address,
    );

    let pause = new AbortController();
    const provider: FixtureMailProvider = {
      ...fixtureProvider,
      sync: async (cursor, signal) => {
        const fetched = await fixtureProvider.sync(cursor, signal);
        batches += 1;
        if (batches === options.pauseAfterBatches) pause.abort();
        return fetched;
      },
    };
    const pipeline = createScanPipeline({
      uow,
      provider,
      classifier,
      clock,
      queue,
      random: () => 0.5,
      workspaceId,
      accountId,
    });
    for (;;) {
      const report = unwrap(await pipeline.run(pause.signal));
      if (report.status === "completed") break;
      pauses += 1;
      pause = new AbortController();
    }
    const retried = unwrap(await pipeline.drainRetries(live()));
    deadLettered += retried.deadLettered;
    deferred += retried.retried + retried.deadLettered;
  }

  const accountIds = [...providers.keys()];
  const counted = unwrap(
    await new SummarizeMailbox({ uow, clock }).execute({ workspaceId, accountIds }),
  );
  const summary: ScenarioSummary = {
    ...counted,
    categories: Object.fromEntries(
      EMAIL_TYPES.map((c) => [c, counted.categories[c] ?? 0]),
    ) as Record<EmailType, number>,
    signals: Object.fromEntries(SIGNAL_KINDS.map((k) => [k, counted.signals[k] ?? 0])) as Record<
      SignalKind,
      number
    >,
  };

  // 2. suggestions, then apply the reversible ones with the user's approval, then undo.
  const propose = new ProposeSuggestions({ uow, clock });
  const archive = new Map<
    AccountId,
    { action: Action; categories: EmailType[]; confidence: number }[]
  >();
  let archiveCount = 0;
  let unsubscribe = 0;
  for (const accountId of accountIds) {
    const items: { action: Action; categories: EmailType[]; confidence: number }[] = [];
    for (const s of unwrap(await propose.execute({ workspaceId, accountId }, live()))) {
      // The demo user approves every suggestion as an archive of its messages. Unsubscribe is
      // never sent: it cannot be undone, so it stays a suggestion for the user (brief §2).
      if (s.recommendation.kind === "unsubscribe") unsubscribe += 1;
      else archiveCount += 1;
      const categories: EmailType[] = [];
      for (const id of s.recommendation.messageIds)
        categories.push(emailTypeOf(unwrap(await uow.reads.messages.get(workspaceId, id))));
      items.push({
        categories,
        confidence: s.confidence,
        action: {
          schemaVersion: 1,
          id: unwrap(ActionId(ids.next("act"))),
          workspaceId,
          suggestionId: s.id,
          idempotencyKey: s.id,
          command: { kind: "archive", messageIds: s.recommendation.messageIds },
          createdAt: clock.now().toISOString(),
        },
      });
    }
    archive.set(accountId, items);
  }

  const before = await mailboxState(uow, workspaceId, providers);
  const applied: ApplyOutcome[] = [];
  const undone: UndoOutcome[] = [];
  const deps = (accountId: AccountId) => ({
    uow,
    provider: providers.get(accountId) as FixtureMailProvider,
    clock,
    ids,
  });
  const batchOf = (accountId: AccountId) => `demo:${accountId}`;
  for (const accountId of accountIds) {
    const report = await new ApplyAction(deps(accountId)).execute(
      {
        batchId: batchOf(accountId),
        items: (archive.get(accountId) ?? []).map(({ action, categories, confidence }) => ({
          action,
          authorization: {
            autonomy: "suggest" as const,
            categories,
            // Protection is decided from signals when suggestions are proposed (ADR 0012), not here.
            // Autopilot does not do that yet (#270): it must not be enabled before #270 lands.
            protectedCategories: [],
            confidence,
            userConfirmed: true,
          },
        })),
      },
      live(),
    );
    applied.push(...report.outcomes);
  }
  const during = await mailboxState(uow, workspaceId, providers);
  for (const accountId of accountIds) {
    const reverted = unwrap(
      await new UndoAction(deps(accountId)).execute(
        { workspaceId, batchId: batchOf(accountId) },
        live(),
      ),
    );
    undone.push(...reverted.outcomes);
  }
  const after = await mailboxState(uow, workspaceId, providers);

  return {
    scale: options.scale,
    scan: { batches, pauses, deferred, deadLettered },
    summary,
    suggestions: { archive: archiveCount, unsubscribe },
    applied,
    undone,
    changedByApply: during !== before,
    mailboxRestored: before === after,
    eval: await runEval({ classifier: truth, mailbox }),
  };
}

/** The mailbox as each provider sees it (archived, labels, handled, unsubscribed), as one string. */
async function mailboxState(
  uow: UnitOfWork,
  workspaceId: WorkspaceId,
  providers: ReadonlyMap<AccountId, FixtureMailProvider>,
): Promise<string> {
  const rows: unknown[] = [];
  for (const [accountId, provider] of providers) {
    let cursor: string | undefined;
    do {
      const page = unwrap(
        await uow.reads.messages.query(workspaceId, {
          accountId,
          limit: 500,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      for (const m of page.items) rows.push([m.id, provider.stateOf(m.id)]);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
  return JSON.stringify(rows);
}
