import type { Account } from "@pochimail/accounts/model/account";
import type { Clock } from "@pochimail/kernel/clock";
import { type CancelSignal, createCancelSource, type Unsubscribe } from "@pochimail/kernel/common";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import type { WorkflowUnitOfWork } from "../ports/unit-of-work.ts";
import type { RunIncrementalSync } from "./run-incremental-sync.ts";
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
  readonly scans: Pick<ScanRunner, "live" | "hasCompleted" | "start">;
  /** The incremental sync for one account; the composition root wires its provider. */
  readonly syncFor: (account: Account) => RunIncrementalSync;
  /** Delivers committed events to subscribers (the outbox relay's drain). */
  readonly flush: () => Promise<void>;
}

/**
 * Runs incremental syncs, one at a time per account: the scheduler and a manual request share the
 * run in flight instead of starting a second. Until an account's first scan has finished that scan
 * is the sync (it owns the cursor and classifies); after a rate limit the account is left alone until
 * the provider's `resumeAt`.
 */
export class SyncRunner {
  private readonly inFlight = new Map<AccountId, Promise<SyncResult>>();
  private readonly resumeAt = new Map<AccountId, string>();
  private readonly last = new Map<AccountId, SyncStatus["last"]>();
  private readonly listeners = new Set<SyncListener>();
  private readonly manual = createCancelSource();

  constructor(private readonly deps: SyncRunnerDeps) {}

  run(accountId: AccountId, signal: CancelSignal): Promise<SyncResult> {
    const running = this.inFlight.get(accountId);
    if (running) return running;
    const started = this.execute(accountId, signal)
      .then((result) => {
        this.last.set(accountId, { result, at: this.deps.clock.now().toISOString() });
        this.inFlight.delete(accountId);
        this.notify({ accountId, running: false, result });
        return result;
      })
      .catch(() => {
        this.inFlight.delete(accountId);
        this.notify({ accountId, running: false, result: { status: "failed" } });
        return { status: "failed" } as const;
      });
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
      ids.map(async (id) => ({ accountId: id, result: await this.run(id, this.manual.signal) })),
    );
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

  private async execute(accountId: AccountId, signal: CancelSignal): Promise<SyncResult> {
    const { uow, workspaceId, clock, scans } = this.deps;
    const account = await uow.reads.accounts.get(workspaceId, accountId);
    if (!account.ok) return { status: "failed" };
    if (scans.live([accountId]).length > 0) return { status: "first-scan" };
    if (!scans.hasCompleted(accountId)) {
      const started = await scans.start(accountId);
      return started.ok ? { status: "first-scan" } : { status: "failed" };
    }
    const waiting = this.resumeAt.get(accountId);
    if (waiting !== undefined && Date.parse(waiting) > clock.now().getTime())
      return { status: "rate-limited", resumeAt: waiting };
    this.resumeAt.delete(accountId);

    const outcome = await this.deps
      .syncFor(account.value)
      .execute({ workspaceId, accountId }, signal)
      .catch(() => undefined);
    await this.deps.flush();
    if (outcome === undefined) return { status: "failed" };
    if (!outcome.ok) {
      return outcome.error.code === "provider.offline"
        ? { status: "offline" }
        : { status: "failed" };
    }
    const value = outcome.value;
    if (value.status === "rate-limited") this.resumeAt.set(accountId, value.resumeAt);
    if (value.status === "completed")
      return { status: "completed", stored: value.stored, restarted: value.restarted };
    if (value.status === "rate-limited")
      return { status: "rate-limited", resumeAt: value.resumeAt };
    return { status: value.status === "paused" ? "paused" : "needs-reauth" };
  }
}
