import { ERROR_CODES } from "@pochimail/kernel/errors";
import {
  brandedId,
  messageIdSchema,
  schemaVersion,
  timestampSchema,
  workspaceIdSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";
import { POLICY_DENIAL_REASONS } from "../errors.ts";
import { ActionId, ActionLogId } from "../ids.ts";

export const actionIdSchema = brandedId(ActionId);
export const actionLogIdSchema = brandedId(ActionLogId);

/** Delete means move to Trash (`trash`, restored by `untrash`): there is no permanent delete (ADR 0012). */
export const ACTION_KINDS = [
  "archive",
  "unarchive",
  "trash",
  "untrash",
  "apply-label",
  "remove-label",
  "mark-handled",
  "unmark-handled",
  "unsubscribe",
] as const;
export const actionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const commandSchema = z.object({
  kind: actionKindSchema,
  messageIds: z.array(messageIdSchema).min(1),
  label: z.string().min(1).optional(),
});
export type Command = z.infer<typeof commandSchema>;

/**
 * The command that reverses `command`, or `null` when nothing can (unsubscribe). Pure fallback:
 * providers report the inverse of what they actually did (`AppliedCommand`), which wins.
 */
export function inverseOf(command: Command): Command | null {
  const swap = {
    archive: "unarchive",
    unarchive: "archive",
    "apply-label": "remove-label",
    "remove-label": "apply-label",
    "mark-handled": "unmark-handled",
    "unmark-handled": "mark-handled",
    trash: "untrash",
    untrash: "trash",
  } as const;
  if (command.kind === "unsubscribe") return null;
  return { ...command, kind: swap[command.kind] };
}

/** The intent: what to do. What was actually done, and how to undo it, lives on the ActionLog. */
export const actionSchema = z.object({
  schemaVersion,
  id: actionIdSchema,
  workspaceId: workspaceIdSchema,
  /** The suggestion this action carries out, by id; the suggestion itself belongs to cleanup. */
  suggestionId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  command: commandSchema,
  createdAt: timestampSchema,
});
export type Action = z.infer<typeof actionSchema>;

/**
 * Brief §5.3: the log records what was actually done plus its inverse, so undo never guesses.
 * The one explicit exception is unsubscribe: it cannot be reversed, so the entry says so
 * (`inverse: null`, `irreversible: true`, with a reason). Any other applied entry needs an inverse.
 * A failed or refused entry changed nothing, so it has nothing to undo.
 */
export const actionLogSchema = z
  .object({
    schemaVersion,
    id: actionLogIdSchema,
    workspaceId: workspaceIdSchema,
    actionId: actionIdSchema,
    /** Entries sharing the key are attempts at one intent; any `applied` one makes a replay a no-op. */
    idempotencyKey: z.string().min(1),
    /** Groups the actions of one batch so the whole batch can be undone. */
    batchId: z.string().min(1).optional(),
    /** `pending` is written before the provider call, so a crash after it leaves a trace to recover from. */
    outcome: z.enum(["pending", "applied", "failed", "undone", "refused"]),
    command: commandSchema,
    inverse: commandSchema.nullable(),
    irreversible: z.boolean(),
    irreversibleReason: z.string().min(1).optional(),
    errorCode: z.enum(ERROR_CODES).optional(),
    /** Set on `refused` entries: which policy rule stopped the action. */
    denialReason: z.enum(POLICY_DENIAL_REASONS).optional(),
    at: timestampSchema,
  })
  .superRefine((log, ctx) => {
    const fail = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    const noUndoNeeded = log.outcome === "failed" || log.outcome === "refused";
    if (log.irreversible) {
      if (log.command.kind !== "unsubscribe")
        fail("only unsubscribe may be irreversible", "irreversible");
      if (log.inverse !== null) fail("an irreversible entry has no inverse", "inverse");
      if (!log.irreversibleReason)
        fail("an irreversible entry needs a reason", "irreversibleReason");
    } else {
      if (log.irreversibleReason !== undefined)
        fail("reason only applies to irreversible", "irreversibleReason");
      if (log.inverse === null && !noUndoNeeded)
        fail("a reversible action must record its inverse", "inverse");
    }
  });
export type ActionLog = z.infer<typeof actionLogSchema>;

/** An entry with its position in the log: the write order every adapter keeps, whatever the clock said. */
export interface Sequenced {
  readonly seq: number;
  readonly entry: ActionLog;
}

/**
 * The `pending` entries written at or before `bootSeq` (the log's last sequence number when this
 * process started) with no later `applied`, `failed`, `undone` or `refused` entry for the same
 * key: the provider call may have happened without being recorded. A retry after a failure
 * writes a new `pending` that counts again. `rows` must be oldest first by `seq`. The in-memory
 * adapters use this, SQL repeats it and the contract suite keeps them equal.
 */
export function unresolvedPending(rows: readonly Sequenced[], bootSeq: number): ActionLog[] {
  const lastSettled = new Map<string, number>();
  for (const { seq, entry } of rows) {
    if (entry.outcome !== "pending") lastSettled.set(settleKey(entry), seq);
  }
  return rows
    .filter(
      ({ seq, entry }) =>
        entry.outcome === "pending" &&
        seq <= bootSeq &&
        seq > (lastSettled.get(settleKey(entry)) ?? 0),
    )
    .map((r) => r.entry);
}
const settleKey = (e: ActionLog) => `${e.workspaceId}\u0000${e.idempotencyKey}`;
