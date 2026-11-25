import type { Account } from "@pochimail/accounts/model/account";
import type { Clock } from "@pochimail/kernel/clock";
import type { CancelSignal } from "@pochimail/kernel/common";
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

  constructor(private readonly deps: SyncRunnerDeps) {}

  run(accountId: AccountId, signal: CancelSignal): Promise<SyncResult> {
    const running = this.inFlight.get(accountId);
    if (running) return running;
    const started = this.execute(accountId, signal).finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, started);
    return started;
  }

  /** Resolves when no sync is running; for orderly shutdown and tests. */
  async idle(): Promise<void> {
    await Promise.all(this.inFlight.values());
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
