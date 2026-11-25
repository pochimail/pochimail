import type { Account } from "@pochimail/accounts/model/account";
import { type AsyncResult, createCancelSource } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import { InvalidStateError, NotFound } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { WorkflowUnitOfWork } from "../ports/unit-of-work.ts";
import type { RunScan } from "./run-scan.ts";

export type ScanJobStatus = "running" | "paused" | "completed" | "cancelled" | "failed";

/** Who paused a scan: the user, or the power state (sleep, battery saver). Only the user's pause is final. */
export type PauseSource = "user" | "power";

interface Job {
  readonly id: string;
  readonly accountId: AccountId;
  status: ScanJobStatus;
  /** Set while paused; a user pause always replaces a power pause. */
  pausedBy: PauseSource | undefined;
  processed: number;
  /** Set once a run reached the end of the mailbox, even if a pause was requested at the same moment. */
  finished: boolean;
  /** Bumped by every run; only the newest run may change `status`. */
  generation: number;
  stop: (() => void) | undefined;
  /** The latest run. A new run waits for it, so two runs never advance one cursor. */
  run: Promise<void>;
}

export interface ScanRunnerDeps {
  readonly uow: WorkflowUnitOfWork;
  readonly workspaceId: WorkspaceId;
  /** A new, unique job id. */
  readonly newJobId: () => string;
  /** The scan for one account; the composition root wires its provider and classifier. */
  readonly scanFor: (account: Account) => RunScan;
}

/**
 * Starts, pauses, resumes and cancels background scans, one running job per account. Starting while the
 * account's scan is already running returns that job, also for two calls that arrive together. Pausing stops
 * at a batch boundary; resuming waits for that boundary and then continues from the stored cursor, so nothing
 * is read twice and nothing is skipped (brief §5.3).
 */
export class ScanRunner {
  private readonly jobs = new Map<string, Job>();
  private readonly starting = new Map<
    AccountId,
    Promise<Result<{ jobId: string }, StorageError | NotFound>>
  >();
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly deps: ScanRunnerDeps) {}

  start(accountId: AccountId): AsyncResult<{ jobId: string }, StorageError | NotFound> {
    const live = [...this.jobs.values()].find(
      (j) => j.accountId === accountId && (j.status === "running" || j.status === "paused"),
    );
    if (live) {
      if (live.status === "paused") this.drive(live);
      return Promise.resolve(ok({ jobId: live.id }));
    }
    // The account lookup is asynchronous: callers that arrive meanwhile share this one start.
    const pending = this.starting.get(accountId);
    if (pending) return pending;
    const created = this.create(accountId).finally(() => this.starting.delete(accountId));
    this.starting.set(accountId, created);
    return created;
  }

  pause(jobId: string, by: PauseSource = "user"): Result<void, NotFound> {
    const job = this.jobs.get(jobId);
    if (!job) return err(new NotFound("Scan"));
    if (job.status === "running") {
      job.status = "paused";
      job.pausedBy = by;
      job.stop?.();
    } else if (job.status === "paused" && by === "user") {
      job.pausedBy = "user";
    }
    return ok(undefined);
  }

  resume(jobId: string): Result<void, NotFound | InvalidStateError> {
    const job = this.jobs.get(jobId);
    if (!job) return err(new NotFound("Scan"));
    if (job.status === "running") return ok(undefined);
    if (job.status !== "paused") return err(new InvalidStateError(`scan is ${job.status}`));
    this.drive(job);
    return ok(undefined);
  }

  /** Stops the job for good; a new `start` begins again from the stored cursor. */
  cancel(jobId: string): Result<void, NotFound> {
    const job = this.jobs.get(jobId);
    if (!job) return err(new NotFound("Scan"));
    if (job.status === "running" || job.status === "paused") {
      job.status = "cancelled";
      job.stop?.();
    }
    return ok(undefined);
  }

  /** Read-only: the running and paused jobs, optionally for some accounts. Never starts or changes anything. */
  live(accountIds?: readonly AccountId[]): {
    jobId: string;
    accountId: AccountId;
    status: "running" | "paused";
    pausedBy: PauseSource | undefined;
    processed: number;
  }[] {
    return [...this.jobs.values()].flatMap((job) =>
      (job.status === "running" || job.status === "paused") &&
      (accountIds === undefined || accountIds.includes(job.accountId))
        ? [
            {
              jobId: job.id,
              accountId: job.accountId,
              status: job.status,
              pausedBy: job.pausedBy,
              processed: job.processed,
            },
          ]
        : [],
    );
  }

  /** Whether a scan of this account reached the end of its mailbox in this session. */
  hasCompleted(accountId: AccountId): boolean {
    return [...this.jobs.values()].some(
      (j) => j.accountId === accountId && j.status === "completed",
    );
  }

  /** Resolves when no job is running; for orderly shutdown and tests. */
  async idle(): Promise<void> {
    await Promise.all(this.running);
  }

  private async create(
    accountId: AccountId,
  ): AsyncResult<{ jobId: string }, StorageError | NotFound> {
    const account = await this.deps.uow.reads.accounts.get(this.deps.workspaceId, accountId);
    if (!account.ok) return account;
    const job: Job = {
      id: this.deps.newJobId(),
      accountId,
      status: "running",
      pausedBy: undefined,
      processed: 0,
      finished: false,
      generation: 0,
      stop: undefined,
      run: Promise.resolve(),
    };
    this.jobs.set(job.id, job);
    this.drive(job);
    return ok({ jobId: job.id });
  }

  private drive(job: Job): void {
    const stop = createCancelSource();
    const generation = job.generation + 1;
    job.generation = generation;
    job.status = "running";
    job.pausedBy = undefined;
    job.stop = stop.abort;
    const previous = job.run;
    const current = (async () => {
      // A paused run may still be finishing its batch: wait, so only one run is ever in flight.
      await previous;
      if (job.finished) {
        if (job.generation === generation) job.status = "completed";
        return;
      }
      if (stop.signal.aborted) return;
      const found = await this.deps.uow.reads.accounts.get(this.deps.workspaceId, job.accountId);
      const outcome = found.ok
        ? await this.deps
            .scanFor(found.value)
            .execute({ jobId: job.id, processedBefore: job.processed }, stop.signal)
            .catch(() => undefined)
        : undefined;
      if (outcome?.ok) {
        job.processed = outcome.value.processed;
        if (outcome.value.status === "completed") job.finished = true;
      }
      if (job.generation !== generation || job.status !== "running") {
        if (job.finished && job.generation === generation && job.status === "paused")
          job.status = "completed";
        return;
      }
      job.status = outcome?.ok ? (job.finished ? "completed" : "paused") : "failed";
    })();
    job.run = current;
    this.running.add(current);
    void current.finally(() => this.running.delete(current));
  }
}
