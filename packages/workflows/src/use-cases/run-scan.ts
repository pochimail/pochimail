import { MarkAccountNeedsReauth } from "@pochimail/accounts/use-cases/mark-account-needs-reauth";
import { BuildDigest } from "@pochimail/cleanup/use-cases/build-digest";
import { type AsyncResult, type CancelSignal, createCancelSource } from "@pochimail/kernel/common";
import { type DomainError, StorageError } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import type { DomainEventOf } from "../events.ts";
import { createScanPipeline, type ScanPipelineDeps } from "../jobs/scan-pipeline.ts";
import type { WorkflowUnitOfWork } from "../ports/unit-of-work.ts";

export interface RunScanDeps extends Omit<ScanPipelineDeps, "onBatchProcessed"> {
  /** Delivers committed events to subscribers (the outbox relay's drain). */
  readonly flush: () => Promise<void>;
}

export interface RunScanRequest {
  /** Stable per scan job; keeps event ids unique across pause and resume. */
  readonly jobId: string;
  /** Emails already counted by earlier runs of the same job. */
  readonly processedBefore?: number;
}

export interface RunScanOutcome {
  readonly status: "completed" | "paused";
  /** Emails processed in this run, plus `processedBefore`. */
  readonly processed: number;
}

/**
 * One scan run for one account: sync → classify → signals (the M1-08 pipeline), with progress and
 * completion as events (`ScanProgressed`, `ScanCompleted`) and a digest of what is new afterwards
 * (`DigestReady`). A pause (aborted signal) stops at a batch boundary and emits no completion; a later
 * run continues from the stored cursor. Counts only: no event carries mail content (AGENTS §5).
 */
export class RunScan {
  constructor(private readonly deps: RunScanDeps) {}

  /**
   * A failed run announces `ScanFailed` (code only) so the screen can say so, then returns the error.
   * Expired credentials also put the account in `needs_reauth`, so the person is asked to reconnect.
   */
  async execute(
    request: RunScanRequest,
    signal: CancelSignal,
  ): AsyncResult<RunScanOutcome, DomainError> {
    const { uow, clock, workspaceId, accountId, flush } = this.deps;
    let failure: DomainError;
    try {
      const outcome = await this.run(request, signal);
      if (outcome.ok) return outcome;
      failure = outcome.error;
    } catch (cause) {
      failure = new StorageError("Scan crashed", { cause });
    }
    if (failure.code !== "operation.cancelled") {
      // A grant the provider refuses even after a token refresh is dead: only reconnecting helps (ADR 0007).
      if (failure.code === "provider.auth_expired")
        await new MarkAccountNeedsReauth({ uow, clock }).execute(
          { workspaceId, accountId },
          createCancelSource().signal,
        );
      const event = {
        id: `scan:${request.jobId}:failed:${clock.now().getTime()}`,
        type: "ScanFailed",
        version: 1,
        workspaceId,
        occurredAt: clock.now().toISOString(),
        payload: { accountId, errorCode: failure.code },
      } satisfies DomainEventOf<"ScanFailed">;
      await uow.run(async (tx) => tx.outbox.append({ kind: "event", event }));
      await flush();
    }
    return err(failure);
  }

  private async run(
    request: RunScanRequest,
    signal: CancelSignal,
  ): AsyncResult<RunScanOutcome, DomainError> {
    const { uow, clock, workspaceId, accountId, flush } = this.deps;
    let processed = request.processedBefore ?? 0;
    let step = 0;
    const append = (event: Parameters<typeof emit>[1]) => emit(uow, event);

    const pipeline = createScanPipeline({
      ...this.deps,
      onBatchProcessed: async (count) => {
        processed += count;
        step += 1;
        await append({
          id: `scan:${request.jobId}:${step}`,
          type: "ScanProgressed",
          version: 1,
          workspaceId,
          occurredAt: clock.now().toISOString(),
          payload: { accountId, processed },
        } satisfies DomainEventOf<"ScanProgressed">);
        await flush();
      },
    });

    const run = await pipeline.run(signal);
    if (!run.ok) return err(run.error as DomainError);
    if (run.value.status === "paused") return ok({ status: "paused", processed });

    // Items that failed a stage (e.g. the model was briefly unavailable) are retried before the scan is called done.
    const retried = await pipeline.drainRetries(signal);
    if (!retried.ok) return err(retried.error);
    if (signal.aborted) return ok({ status: "paused", processed });

    const completed = await append({
      id: `scan:${request.jobId}:done`,
      type: "ScanCompleted",
      version: 1,
      workspaceId,
      occurredAt: clock.now().toISOString(),
      payload: { accountId, processed },
    } satisfies DomainEventOf<"ScanCompleted">);
    if (!completed.ok) return err(completed.error);
    const digest = await new BuildDigest({ uow, clock }).execute(
      { workspaceId, accountId },
      signal,
    );
    if (!digest.ok) return err(digest.error);
    await flush();
    return ok({ status: "completed", processed });
  }
}

const emit = (
  uow: WorkflowUnitOfWork,
  event: DomainEventOf<"ScanProgressed"> | DomainEventOf<"ScanCompleted">,
) => uow.run(async (tx) => tx.outbox.append({ kind: "event", event }));
