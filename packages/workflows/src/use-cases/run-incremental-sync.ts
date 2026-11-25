import { type AccountState, accountStateEvent } from "@pochimail/accounts/events";
import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import {
  AuthExpired,
  Cancelled,
  type DomainError,
  type NotFound,
  RateLimited,
  type StorageError,
} from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { sanitizeIncoming } from "@pochimail/mailbox/policies/sanitize-incoming";
import type { SyncCursor } from "@pochimail/mailbox/ports/mail-reader";
import { UpsertThreads } from "@pochimail/mailbox/use-cases/upsert-threads";
import type { JobRequest } from "@pochimail/pipeline/job-queue";
import type { DomainEvent, DomainEventOf, DomainEventType } from "../events.ts";
import { flagSuspicious } from "../flag-suspicious.ts";
import type { MailProvider } from "../ports/mail-provider.ts";
import type { WorkflowUnitOfWork } from "../ports/unit-of-work.ts";

/** Job type enqueued to resume a rate-limited sync; a worker maps it back to this use case. */
export const INCREMENTAL_SYNC_JOB = "sync.incremental";
export const DEFAULT_CURSOR_SCOPE = "inbox";
export const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000;

export interface RunIncrementalSyncDeps {
  readonly uow: WorkflowUnitOfWork;
  readonly provider: MailProvider;
  readonly clock: Clock;
}

export interface RunIncrementalSyncRequest {
  readonly workspaceId: WorkspaceId;
  readonly accountId: AccountId;
  /** Which cursor to resume from. Default `inbox`. */
  readonly cursorScope?: string;
}

interface Progress {
  readonly batches: number;
  /** Messages the provider returned. */
  readonly fetched: number;
  /** Messages written to the store (invalid or foreign ones are skipped). */
  readonly stored: number;
}

export type RunIncrementalSyncOutcome =
  | (Progress & { readonly status: "completed"; readonly restarted: boolean })
  /** The signal fired: progress is committed, a later run resumes from the cursor. */
  | (Progress & { readonly status: "paused" })
  /** The provider asked us to slow down: state `paused`, a resume job is queued for `resumeAt`. */
  | (Progress & { readonly status: "rate-limited"; readonly resumeAt: string })
  /** Credentials expired: state `needs_reauth`. */
  | (Progress & { readonly status: "needs-reauth" });

export type RunIncrementalSyncError = StorageError | NotFound | Cancelled | DomainError;

/**
 * Pulls mail by cursor and stores headers and metadata only (follows proposed D11: bodies are
 * fetched on demand and never persisted here). Each batch commits rows, the new cursor and its
 * progress events in ONE transaction, so an interruption at any point resumes with neither
 * a gap nor a repeat, and the final state equals an uninterrupted run.
 *
 * Failure handling: `RateLimited` → account state `paused` + a resume job at `resumeAt`
 * (honouring `retryAfterMs`); `AuthExpired` → `needs_reauth`; `Cancelled` or an aborted signal →
 * `paused` outcome; anything else is returned as an error with committed batches kept.
 */
export class RunIncrementalSync {
  constructor(private readonly deps: RunIncrementalSyncDeps) {}

  async execute(
    request: RunIncrementalSyncRequest,
    signal: CancelSignal,
  ): AsyncResult<RunIncrementalSyncOutcome, RunIncrementalSyncError> {
    const { uow, provider } = this.deps;
    const { workspaceId, accountId } = request;
    const scope = request.cursorScope ?? DEFAULT_CURSOR_SCOPE;

    const account = await uow.reads.accounts.get(workspaceId, accountId);
    if (!account.ok) return account;
    const stored = await uow.reads.cursors.get(workspaceId, accountId, scope);
    if (!stored.ok) return stored;

    let cursor: SyncCursor | null = stored.value;
    let progress: Progress = { batches: 0, fetched: 0, stored: 0 };
    let restarted = false;

    const event = <T extends DomainEventType>(
      type: T,
      id: string,
      payload: DomainEventOf<T>["payload"],
    ): DomainEvent =>
      ({
        id,
        type,
        version: 1,
        workspaceId,
        occurredAt: this.deps.clock.now().toISOString(),
        payload,
      }) as DomainEvent;
    const state = (s: AccountState) =>
      accountStateEvent({
        workspaceId,
        accountId,
        state: s,
        occurredAt: this.deps.clock.now().toISOString(),
      });
    const emit = (events: readonly DomainEvent[], job?: JobRequest) =>
      uow.run(async (tx) => {
        for (const e of events) {
          const appended = await tx.outbox.append({ kind: "event", event: e });
          if (!appended.ok) return appended;
        }
        return job ? tx.outbox.append({ kind: "job", workspaceId, job }) : ok(undefined);
      });
    const pausedByCaller = async (): AsyncResult<
      RunIncrementalSyncOutcome,
      RunIncrementalSyncError
    > => {
      const left = await emit([state("connected")]);
      return left.ok ? ok({ status: "paused", ...progress }) : left;
    };

    const began = await emit([state("syncing")]);
    if (!began.ok) return began;

    for (;;) {
      if (signal.aborted) return pausedByCaller();
      const position = cursor?.token ?? "start";
      const batch = await provider.sync(cursor, signal);

      if (!batch.ok) {
        const failure = batch.error;
        if (failure instanceof Cancelled) return pausedByCaller();
        if (failure instanceof RateLimited) {
          const resumeAt = new Date(
            this.deps.clock.now().getTime() + (failure.retryAfterMs ?? DEFAULT_RATE_LIMIT_DELAY_MS),
          ).toISOString();
          const paused = await emit([state("paused")], {
            type: INCREMENTAL_SYNC_JOB,
            payload: { accountId, cursorScope: scope },
            idempotencyKey: `${INCREMENTAL_SYNC_JOB}:${accountId}:${scope}:${resumeAt}`,
            runAt: resumeAt,
          });
          return paused.ok ? ok({ status: "rate-limited", resumeAt, ...progress }) : paused;
        }
        if (failure instanceof AuthExpired) {
          const reauth = await emit([state("needs_reauth")]);
          return reauth.ok ? ok({ status: "needs-reauth", ...progress }) : reauth;
        }
        // Offline and the rest: committed batches stay; the caller decides when to retry.
        await emit([state("connected")]);
        return batch;
      }

      const { messages, nextCursor, hasMore } = batch.value;
      const keep = messages.flatMap((m) => sanitizeIncoming(m, request)).map(flagSuspicious);
      const key = `${accountId}:${scope}:${position}`;
      const committed = await uow.run(async (tx) => {
        const rows = await tx.repositories.messages.upsertMany(keep);
        if (!rows.ok) return rows;
        const threads = await new UpsertThreads().execute(tx, keep);
        if (!threads.ok) return threads;
        const saved = await tx.repositories.cursors.set(workspaceId, accountId, nextCursor);
        if (!saved.ok) return saved;
        const events = [
          event("SyncBatchFetched", `${key}:fetched`, { accountId, fetched: messages.length }),
          event("MessagesUpserted", `${key}:upserted`, { accountId, count: keep.length }),
          event("ScanProgressed", `${key}:progress`, {
            accountId,
            processed: progress.stored + keep.length,
          }),
        ];
        for (const e of events) {
          const appended = await tx.outbox.append({ kind: "event", event: e });
          if (!appended.ok) return appended;
        }
        return ok(undefined);
      });
      // Not given the signal: a fetched batch always commits, so a pause never wastes it.
      if (!committed.ok) return committed;

      progress = {
        batches: progress.batches + 1,
        fetched: progress.fetched + messages.length,
        stored: progress.stored + keep.length,
      };
      restarted = restarted || batch.value.restarted;
      cursor = nextCursor;
      if (!hasMore) break;
    }

    const done = await emit([
      event("ScanCompleted", `${accountId}:${scope}:completed:${cursor?.token ?? "start"}`, {
        accountId,
        processed: progress.stored,
      }),
      state("connected"),
    ]);
    return done.ok ? ok({ status: "completed", restarted, ...progress }) : done;
  }
}
