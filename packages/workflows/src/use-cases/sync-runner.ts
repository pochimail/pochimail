import type { Account } from "@pochimail/accounts/model/account";
import type { Clock } from "@pochimail/kernel/clock";
import { type CancelSignal, createCancelSource, type Unsubscribe } from "@pochimail/kernel/common";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import type { DomainEventOf } from "../events.ts";
import type { WorkflowUnitOfWork } from "../ports/unit-of-work.ts";
import type { ClassifyPending } from "./classify-pending.ts";
import type { RunIncrementalSync } from "./run-incremental-sync.ts";
import { FIRST_SCAN_DONE } from "./run-scan.ts";
import type { ScanRunner } from "./scan-runner.ts";

/** How one sync of one account ended. Closed on purpose: nothing of a provider's answer rides along. */
export type SyncResult =
  | { readonly status: "completed"; readonly stored: number; readonly restarted: boolean }
  /** The first scan owns the cursor: it runs (or was started) instead of an incremental sync. */
  | { readonly status: "first-scan" }
  | { readonly status: "paused" }
  | { readonly status: "rate-limited"; readonly resumeAt: string }
  | { readonly status: "needs-reauth" }
  | { readonly status: "offline" }
  | { readonly status: "failed" };

/** One account's sync state, for a screen that opens or reloads while a sync is running. */
export interface SyncStatus {
  readonly accountId: AccountId;
  readonly running: boolean;
  /** The last sync that ended in this session, if any. */
  readonly last: { readonly result: SyncResult; readonly at: string } | null;
}

export type SyncListener = (change: {
  readonly accountId: AccountId;
  readonly running: boolean;
  /** Present when the run ended. */
  readonly result?: SyncResult;
}) => void;

export interface SyncRunnerDeps {
  readonly uow: WorkflowUnitOfWork;
  readonly workspaceId: WorkspaceId;
  readonly clock: Clock;
  readonly scans: Pick<ScanRunner, "busy" | "latest" | "start">;
  /** The incremental sync for one account; the composition root wires its provider. */
  readonly syncFor: (account: Account) => RunIncrementalSync;
  /** Classifies what the sync stored and what earlier runs left unclassified. */
  readonly classifyFor: (account: Account) => ClassifyPending;
  /** Delivers committed events to subscribers (the outbox relay's drain). */
  readonly flush: () => Promise<void>;
}

/**
 * Runs the syncs of the accounts, one at a time per account: the scheduler and a manual request share the
 * run in flight instead of starting a second, so one writer holds an account's cursor at any moment.
 * Until the first scan of an account has finished (the persisted `FIRST_SCAN_DONE` marker) that scan is the
 * sync: it is started, quietly when the scheduler retries it, and never again after the person cancelled it.
 * After it, each run stores new mail, then classifies it and anything left unclassified. A rate-limited account
 * is left alone until the provider's `resumeAt`, and one whose sign-in expired until it is connected again.
 */
export class SyncRunner {
  private readonly inFlight = new Map<AccountId, Promise<SyncResult>>();
  private readonly resumeAt = new Map<AccountId, string>();
  private readonly needsReauth = new Set<AccountId>();
  private readonly last = new Map<AccountId, SyncStatus["last"]>();
  private readonly listeners = new Set<SyncListener>();
  private readonly manual = createCancelSource();

  constructor(private readonly deps: SyncRunnerDeps) {}

  /** `manual` is a person's request: it may restart a scan they cancelled, and a failed scan is announced. */
  run(accountId: AccountId, signal: CancelSignal, manual = false): Promise<SyncResult> {
    const running = this.inFlight.get(accountId);
    if (running) return running;
    const started = this.execute(accountId, signal, manual)
      .then((result) => this.finish(accountId, result))
      .catch(() => this.finish(accountId, { status: "failed" }));
    this.inFlight.set(accountId, started);
    this.notify({ accountId, running: true });
    return started;
  }

  /**
   * A manual sync: the account named, or every account when none is. Each account runs on its own, so one
   * that fails never stops the others, and one already syncing is joined, not started twice.
   */
  async now(
    accountId?: AccountId,
  ): Promise<readonly { readonly accountId: AccountId; readonly result: SyncResult }[]> {
    const ids = accountId === undefined ? await this.accountIds() : [accountId];
    return Promise.all(
      ids.map(async (id) => ({
        accountId: id,
        result: await this.run(id, this.manual.signal, true),
      })),
    );
  }

  /** Resolves when the account's sync in flight, if any, has ended: a scan started now never shares its cursor. */
  async settled(accountId: AccountId): Promise<void> {
    await this.inFlight.get(accountId);
  }

  /** The account signed in again: syncing it is worth trying once more. */
  reconnected(accountId: AccountId): void {
    this.needsReauth.delete(accountId);
  }

  status(accountIds: readonly AccountId[]): SyncStatus[] {
    return accountIds.map((accountId) => ({
      accountId,
      running: this.inFlight.has(accountId),
      last: this.last.get(accountId) ?? null,
    }));
  }

  onChange(listener: SyncListener): Unsubscribe {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Aborts the manual syncs, then waits for every run to end; polling is stopped by its own owner. */
  async stop(): Promise<void> {
    this.manual.abort();
    await this.idle();
  }

  /** Resolves when no sync is running; for orderly shutdown and tests. */
  async idle(): Promise<void> {
    await Promise.all(this.inFlight.values());
  }

  private finish(accountId: AccountId, result: SyncResult): SyncResult {
    this.last.set(accountId, { result, at: this.deps.clock.now().toISOString() });
    this.inFlight.delete(accountId);
    this.notify({ accountId, running: false, result });
    return result;
  }

  private async accountIds(): Promise<AccountId[]> {
    const listed = await this.deps.uow.reads.accounts.list(this.deps.workspaceId);
    return listed.ok ? listed.value.map((account) => account.id) : [];
  }

  private notify(change: Parameters<SyncListener>[0]): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        // A failing listener must not stop the sync or the others.
      }
    }
  }

  /** The first scan of the account, when it has not finished; `undefined` once the incremental sync takes over. */
  private async firstScan(accountId: AccountId, manual: boolean): Promise<SyncResult | undefined> {
    const { uow, workspaceId, scans } = this.deps;
    if (scans.busy(accountId)) return { status: "first-scan" };
    const done = await uow.reads.cursors.get(workspaceId, accountId, FIRST_SCAN_DONE.scope);
    if (!done.ok) return { status: "failed" };
    if (done.value !== null) return undefined;
    if (scans.latest(accountId) === "cancelled" && !manual) return { status: "paused" };
    const started = await scans.start(accountId, { announceFailure: manual });
    return started.ok ? { status: "first-scan" } : { status: "failed" };
  }

  private async execute(
    accountId: AccountId,
    signal: CancelSignal,
    manual: boolean,
  ): Promise<SyncResult> {
    const { uow, workspaceId, clock } = this.deps;
    if (this.needsReauth.has(accountId)) return { status: "needs-reauth" };
    const account = await uow.reads.accounts.get(workspaceId, accountId);
    if (!account.ok) return { status: "failed" };
    const first = await this.firstScan(accountId, manual);
    if (first !== undefined) return first;

    const waiting = this.resumeAt.get(accountId);
    if (waiting !== undefined && Date.parse(waiting) > clock.now().getTime())
      return { status: "rate-limited", resumeAt: waiting };
    this.resumeAt.delete(accountId);

    const outcome = await this.deps
      .syncFor(account.value)
      .execute({ workspaceId, accountId }, signal)
      .catch(() => undefined);
    const classified = signal.aborted
      ? undefined
      : await this.deps
          .classifyFor(account.value)
          .execute(signal)
          .catch(() => undefined);
    const stored = outcome?.ok ? outcome.value.stored : 0;
    if (stored > 0 || (classified?.ok && classified.value.classified > 0)) {
      await this.announce(accountId, stored, classified?.ok ? classified.value.classified : 0);
    }
    await this.deps.flush();
    return this.resultOf(accountId, outcome);
  }

  private resultOf(
    accountId: AccountId,
    outcome: Awaited<ReturnType<RunIncrementalSync["execute"]>> | undefined,
  ): SyncResult {
    if (outcome === undefined) return { status: "failed" };
    if (!outcome.ok) {
      return outcome.error.code === "provider.offline"
        ? { status: "offline" }
        : { status: "failed" };
    }
    const value = outcome.value;
    if (value.status === "completed")
      return { status: "completed", stored: value.stored, restarted: value.restarted };
    if (value.status === "rate-limited") {
      this.resumeAt.set(accountId, value.resumeAt);
      return { status: "rate-limited", resumeAt: value.resumeAt };
    }
    if (value.status === "needs-reauth") {
      this.needsReauth.add(accountId);
      return { status: "needs-reauth" };
    }
    return { status: "paused" };
  }

  /** One event when a sync changed something, never as scan progress: the first scan's final count stands. */
  private async announce(accountId: AccountId, stored: number, classified: number): Promise<void> {
    const { uow, workspaceId, clock } = this.deps;
    const at = clock.now();
    const event = {
      id: `sync:${accountId}:${at.getTime()}`,
      type: "SyncCompleted",
      version: 1,
      workspaceId,
      occurredAt: at.toISOString(),
      payload: { accountId, stored, classified },
    } satisfies DomainEventOf<"SyncCompleted">;
    await uow.run((tx) => tx.outbox.append({ kind: "event", event }));
  }
}
