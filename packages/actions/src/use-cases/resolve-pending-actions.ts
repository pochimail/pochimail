import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { ErrorCode, NotFound, StorageError } from "@pochimail/kernel/errors";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { ActionLogId as makeLogId } from "../ids.ts";
import type { ActionLog, Command } from "../model/action.ts";
import { type MailCommands, PartiallyApplied } from "../ports/mail-commands.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";
import { RecordEntry } from "./record-entry.ts";
import { type EntryBase, settleProviderResult } from "./settle-provider-result.ts";

export interface ResolvePendingActionsDeps {
  readonly uow: ActionsUnitOfWork;
  /** The provider that holds the entry's messages; `NotFound` when they are gone (account removed). */
  readonly providerFor: (entry: ActionLog) => AsyncResult<MailCommands, NotFound | StorageError>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ResolvePendingReport {
  /** Entries now `applied` or `failed`. */
  readonly settled: number;
  /** Entries left `pending` to try again at the next start (provider unreachable, storage error). */
  readonly deferred: number;
}

/** The provider may simply be unreachable at start (or hiccup): the entry stays pending for the next start. */
const TRY_AGAIN_LATER: readonly ErrorCode[] = [
  "provider.offline",
  "provider.rate_limited",
  "provider.auth_expired",
  "provider.failed",
];

/** Re-applying these after a long absence could undo what the user did meanwhile (restored or moved the mail back). */
const NOT_REPLAYED_WHEN_STALE: readonly Command["kind"][] = ["trash", "archive"];

/** A `pending` entry older than this whose replay still fails transiently is closed `failed` (`action.replay_expired`). */
export const MAX_REPLAY_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Run once at start, before new work. Settles every `pending` entry a crash left behind by
 * replaying its command: provider commands are idempotent, so a replay after a call that already
 * happened changes nothing, and one that never happened completes what the user asked. The entry
 * then becomes `applied` with the provider's inverse, so Activity shows it and Undo reverses it.
 * An unsubscribe is never sent twice: it is closed as `failed` (`action.outcome_unknown`, the
 * request may or may not have left) and the user may ask again. Past `MAX_REPLAY_AGE_MS` a trash
 * or archive is closed the same way instead of being replayed: the mail may have been moved back
 * since. Every other entry gets one replay, however old; one whose replay fails transiently past
 * that age is closed `failed` (`action.replay_expired`). Only entries written up to `bootSeq`, the log's last sequence number when this
 * process started, are touched: actions running now are never replayed.
 */
export class ResolvePendingActions {
  constructor(private readonly deps: ResolvePendingActionsDeps) {}

  async execute(
    workspaceId: WorkspaceId,
    bootSeq: number,
    signal: CancelSignal,
  ): AsyncResult<ResolvePendingReport, StorageError> {
    const { uow } = this.deps;
    const pending = await uow.reads.actionLog.listPending(workspaceId, bootSeq);
    if (!pending.ok) return pending;
    let settled = 0;
    let deferred = 0;
    for (const entry of pending.value) {
      if (signal.aborted) break;
      const outcome = await this.resolve(entry, signal);
      if (outcome === "cancelled") break;
      if (outcome === "deferred") deferred++;
      else settled++;
    }
    return { ok: true, value: { settled, deferred } };
  }

  private async resolve(
    entry: ActionLog,
    signal: CancelSignal,
  ): Promise<"settled" | "deferred" | "cancelled"> {
    const { uow, clock, ids } = this.deps;
    const record = new RecordEntry({ uow });
    const base = (): EntryBase => ({
      schemaVersion: 1,
      id: unwrap(makeLogId(ids.next("log"))),
      workspaceId: entry.workspaceId,
      actionId: entry.actionId,
      idempotencyKey: entry.idempotencyKey,
      ...(entry.batchId === undefined ? {} : { batchId: entry.batchId }),
      at: clock.now().toISOString(),
    });
    const close = async (errorCode: ErrorCode) => {
      const closed: ActionLog = {
        ...base(),
        outcome: "failed",
        command: entry.command,
        inverse: null,
        irreversible: false,
        errorCode,
      };
      const saved = await record.execute({ entry: closed, type: "ActionFailed", errorCode });
      return saved.ok ? "settled" : "deferred";
    };

    if (entry.command.kind === "unsubscribe") return close("action.outcome_unknown");
    const expired = () => clock.now().getTime() - Date.parse(entry.at) > MAX_REPLAY_AGE_MS;
    if (expired() && NOT_REPLAYED_WHEN_STALE.includes(entry.command.kind)) {
      return close("action.outcome_unknown");
    }
    const provider = await this.deps.providerFor(entry);
    if (!provider.ok) {
      if (provider.error.code === "storage.not_found") return close("storage.not_found");
      return expired() ? close("action.replay_expired") : "deferred";
    }
    const result = await provider.value.applyCommands([entry.command], signal);
    if (
      !result.ok &&
      !(result.error instanceof PartiallyApplied) &&
      TRY_AGAIN_LATER.includes(result.error.code)
    ) {
      return expired() ? close("action.replay_expired") : "deferred";
    }
    const done = await settleProviderResult({
      record,
      base,
      command: entry.command,
      result,
      closeCancelled: false,
    });
    if (done.status === "cancelled") return "cancelled";
    return done.status === "applied" || done.logId !== undefined ? "settled" : "deferred";
  }
}
