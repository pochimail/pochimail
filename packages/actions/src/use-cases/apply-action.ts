import type { Clock } from "@pochimail/kernel/clock";
import type { CancelSignal } from "@pochimail/kernel/common";
import { Cancelled, type DomainError } from "@pochimail/kernel/errors";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import { unwrap } from "@pochimail/kernel/result";
import type { PolicyDenialReason, PolicyDenied } from "../errors.ts";
import type { ActionId, ActionLogId } from "../ids.ts";
import { ActionLogId as makeLogId } from "../ids.ts";
import { type Action, type ActionLog, inverseOf } from "../model/action.ts";
import { type AuthorizationContext, authorize } from "../policies/authorize.ts";
import type { MailCommands } from "../ports/mail-commands.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";
import { RecordEntry } from "./record-entry.ts";
import { settleProviderResult } from "./settle-provider-result.ts";

export interface ApplyActionDeps {
  readonly uow: ActionsUnitOfWork;
  readonly provider: MailCommands;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ApplyActionItem {
  readonly action: Action;
  /** What the caller knows about this action; the workspace comes from the action itself. */
  readonly authorization: Omit<AuthorizationContext, "workspaceId">;
}

export interface ApplyActionRequest {
  /** Groups the items so `UndoAction` can reverse the whole batch. */
  readonly batchId?: string;
  readonly items: readonly ApplyActionItem[];
}

export type ApplyOutcome =
  | { readonly status: "applied"; readonly actionId: ActionId; readonly logId: ActionLogId }
  /** The key was already applied (or applied and undone): the provider was not called. */
  | { readonly status: "already-applied"; readonly actionId: ActionId; readonly logId: ActionLogId }
  | {
      readonly status: "refused";
      readonly actionId: ActionId;
      readonly logId?: ActionLogId;
      readonly reason: PolicyDenialReason;
    }
  | {
      readonly status: "failed";
      readonly actionId: ActionId;
      readonly logId?: ActionLogId;
      readonly error: DomainError;
    };

export interface ApplyActionReport {
  readonly outcomes: readonly ApplyOutcome[];
  /** The signal fired: items after the last outcome were not attempted. */
  readonly cancelled: boolean;
}

/**
 * authorize → execute through the MailProvider → record in the ActionLog → emit an event.
 *
 * - Idempotent: a key with an `applied` (or `undone`) entry never reaches the provider again.
 *   To re-apply after an undo, issue a new action with a new key. A key with only `failed` or
 *   `refused` entries may be retried.
 * - The provider call sits outside the transaction (no network I/O inside a DB transaction). A
 *   `pending` entry is written before it; the `applied` or `failed` entry and its outbox event
 *   commit together right after. A crash in between leaves the `pending` entry, which
 *   `ResolvePendingActions` settles on the next start.
 * - Partial failure: one failing action is logged `failed` and the batch continues.
 */
export class ApplyAction {
  private readonly inFlight = new Map<string, Promise<ApplyOutcome | "cancelled">>();

  constructor(private readonly deps: ApplyActionDeps) {}

  async execute(request: ApplyActionRequest, signal: CancelSignal): Promise<ApplyActionReport> {
    const outcomes: ApplyOutcome[] = [];
    for (const item of request.items) {
      const key = `${item.action.workspaceId}\u0000${item.action.idempotencyKey}`;
      // Two concurrent calls with one key (a double click) share one attempt.
      let attempt = this.inFlight.get(key);
      if (!attempt) {
        attempt = this.applyOne(item, request.batchId, signal).finally(() =>
          this.inFlight.delete(key),
        );
        this.inFlight.set(key, attempt);
      }
      const outcome = await attempt;
      if (outcome === "cancelled") return { outcomes, cancelled: true };
      outcomes.push(outcome);
    }
    return { outcomes, cancelled: false };
  }

  private async applyOne(
    { action, authorization }: ApplyActionItem,
    batchId: string | undefined,
    signal: CancelSignal,
  ): Promise<ApplyOutcome | "cancelled"> {
    const { uow, provider, clock, ids } = this.deps;
    const record = new RecordEntry({ uow });
    const ws = action.workspaceId;
    const actionId = action.id;
    const failed = (error: DomainError, logId?: ActionLogId): ApplyOutcome =>
      logId === undefined
        ? { status: "failed", actionId, error }
        : { status: "failed", actionId, logId, error };

    const prior = await uow.reads.actionLog.listForKey(ws, action.idempotencyKey);
    if (!prior.ok) return failed(prior.error);
    const done = prior.value.find((e) => e.outcome === "applied" || e.outcome === "undone");
    if (done) return { status: "already-applied", actionId: done.actionId, logId: done.id };

    const base = () => ({
      schemaVersion: 1 as const,
      id: unwrap(makeLogId(ids.next("log"))),
      workspaceId: ws,
      actionId,
      idempotencyKey: action.idempotencyKey,
      ...(batchId === undefined ? {} : { batchId }),
      at: clock.now().toISOString(),
    });

    const decision = authorize(action.command, { ...authorization, workspaceId: ws });
    if (!decision.ok) {
      const denied: PolicyDenied = decision.error;
      const entry: ActionLog = {
        ...base(),
        outcome: "refused",
        command: action.command,
        inverse: null,
        irreversible: false,
        errorCode: denied.code,
        denialReason: denied.reason,
      };
      const saved = await record.execute({ entry, type: "ActionFailed", errorCode: denied.code });
      return saved.ok
        ? { status: "refused", actionId, logId: entry.id, reason: denied.reason }
        : failed(saved.error);
    }

    if (signal.aborted) return "cancelled";
    // Written before the call: a crash after the provider acted still leaves this entry, which
    // `ResolvePendingActions` settles on the next start (so the change shows in Activity and undoes).
    const irreversible = action.command.kind === "unsubscribe";
    const pending: ActionLog = {
      ...base(),
      outcome: "pending",
      command: action.command,
      inverse: irreversible ? null : inverseOf(action.command),
      irreversible,
      ...(irreversible ? { irreversibleReason: "An unsubscribe request cannot be recalled" } : {}),
    };
    const written = await uow.run((tx) => tx.repositories.actionLog.append(pending), signal);
    if (!written.ok)
      return written.error instanceof Cancelled ? "cancelled" : failed(written.error);

    const result = await provider.applyCommands([action.command], signal);
    const settled = await settleProviderResult({
      record,
      base,
      command: action.command,
      result,
    });
    if (settled.status === "cancelled") return "cancelled";
    if (settled.status === "applied") return { status: "applied", actionId, logId: settled.logId };
    return failed(settled.error, settled.logId);
  }
}
