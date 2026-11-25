import { Cancelled, type DomainError, InvalidStateError } from "@pochimail/kernel/errors";
import type { Result } from "@pochimail/kernel/result";
import type { ActionLogId } from "../ids.ts";
import { type ActionLog, type Command, inverseOf } from "../model/action.ts";
import {
  type AppliedCommand,
  type MailProviderError,
  PartiallyApplied,
} from "../ports/mail-commands.ts";
import type { RecordEntry } from "./record-entry.ts";

export type Settled =
  | { readonly status: "applied"; readonly logId: ActionLogId }
  | { readonly status: "failed"; readonly error: DomainError; readonly logId?: ActionLogId }
  | { readonly status: "cancelled" };

export type EntryBase = Pick<
  ActionLog,
  "schemaVersion" | "id" | "workspaceId" | "actionId" | "idempotencyKey" | "batchId" | "at"
>;

export interface SettleRequest {
  readonly record: RecordEntry;
  /** A fresh entry skeleton (new id and time) for each entry written. */
  readonly base: () => EntryBase;
  readonly command: Command;
  readonly result: Result<readonly AppliedCommand[], MailProviderError>;
}

/**
 * Records what a provider call did after `pending` was written: `applied` with the inverse the
 * provider reports, or `failed`. Shared by `ApplyAction` and `ResolvePendingActions`, so a replay
 * after a crash is logged exactly like the first attempt.
 */
export async function settleProviderResult(request: SettleRequest): Promise<Settled> {
  const { result } = request;
  if (!result.ok) return settleFailure(request, result.error);
  const applied = result.value[0];
  if (result.value.length !== 1 || !applied) {
    return {
      status: "failed",
      error: new InvalidStateError("Provider must answer one result per command"),
    };
  }
  return settleSuccess(request, applied);
}

async function settleFailure(
  { record, base, command }: SettleRequest,
  error: MailProviderError,
): Promise<Settled> {
  const partial = error instanceof PartiallyApplied ? error : null;
  // What the provider did before failing is logged as applied, each with its own inverse, so
  // undo reverses exactly that part; the failure of the rest is logged next to it.
  for (const done of partial?.applied ?? []) {
    const entry: ActionLog = {
      ...base(),
      outcome: "applied",
      command: done.command,
      inverse: done.inverse ?? inverseOf(done.command),
      irreversible: false,
    };
    const saved = await record.execute({ entry, type: "ActionApplied" });
    if (!saved.ok) return { status: "failed", error: saved.error };
  }
  if ((partial?.failure ?? error) instanceof Cancelled) return { status: "cancelled" };
  const entry: ActionLog = {
    ...base(),
    outcome: "failed",
    command,
    inverse: null,
    irreversible: false,
    errorCode: error.code,
  };
  const saved = await record.execute({ entry, type: "ActionFailed", errorCode: error.code });
  return saved.ok
    ? { status: "failed", error, logId: entry.id }
    : { status: "failed", error: saved.error };
}

async function settleSuccess(
  { record, base, command }: SettleRequest,
  applied: AppliedCommand,
): Promise<Settled> {
  const irreversible = command.kind === "unsubscribe";
  const entry: ActionLog = {
    ...base(),
    outcome: "applied",
    command: applied.command,
    // The provider reports what it really did; the pure inverse is the fallback.
    inverse: irreversible ? null : (applied.inverse ?? inverseOf(applied.command)),
    irreversible,
    ...(irreversible ? { irreversibleReason: "An unsubscribe request cannot be recalled" } : {}),
  };
  const saved = await record.execute({ entry, type: "ActionApplied" });
  return saved.ok
    ? { status: "applied", logId: entry.id }
    : { status: "failed", error: saved.error };
}
