import { actionLogSchema } from "@pochimail/actions/model/action";
import type { Database } from "better-sqlite3-multiple-ciphers";
import type { z } from "zod";
import { decodeCursor, page } from "../shared/paging.ts";
import { find, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { flag, json, num, orUndefined, text } from "../shared/values.ts";

/** An anonymised entry keeps its kind and message count; the ids and labels are gone. */
const redactedCommand = (kind: unknown, count: unknown) => ({
  kind,
  messageIds: Array.from({ length: Math.max(1, Number(count)) }, (_, i) => `removed-${i + 1}`),
});

const logOf = (r: Row) =>
  actionLogSchema.parse({
    schemaVersion: 1,
    id: r.id,
    workspaceId: r.workspace_id,
    actionId: r.action_id,
    idempotencyKey: r.idempotency_key,
    ...orUndefined("batchId", r.batch_id),
    outcome: r.outcome,
    command:
      r.command === null ? redactedCommand(r.command_kind, r.message_count) : json(r.command),
    inverse:
      r.inverse !== null
        ? json(r.inverse)
        : r.command === null && r.inverse_kind !== null
          ? redactedCommand(r.inverse_kind, r.message_count)
          : null,
    irreversible: flag(r.irreversible),
    ...orUndefined("irreversibleReason", r.irreversible_reason),
    ...orUndefined("errorCode", r.error_code),
    ...orUndefined("denialReason", r.denial_reason),
    at: r.at,
  });

/** Repository over one connection. */
export function createActionLogRepository(db: Database) {
  const { all, one, run } = sqlHelpers(db);
  // ---- action log (append-only: triggers refuse update and delete) ----
  // #114: an executed archive/unarchive (applied, or the inverse an undo ran) marks the stored
  // messages; the log stays the source of truth and a re-sync never overwrites the marker.
  const archiveMarker = db.prepare(
    `UPDATE message SET archived = ?
     WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?, '$.messageIds'))`,
  );
  const logs = (where: string, ...params: unknown[]) =>
    guard(() =>
      all(
        `SELECT * FROM action_log WHERE workspace_id = ? AND ${where} ORDER BY at, seq`,
        ...params,
      ).map(logOf),
    );
  const actionLog = {
    get: (ws: string, id: string) =>
      find("Action log entry", () => {
        const r = one("SELECT * FROM action_log WHERE workspace_id = ? AND id = ?", ws, id);
        return r === undefined ? undefined : logOf(r);
      }),
    listForAction: (ws: string, actionId: string) => logs("action_id = ?", ws, actionId),
    listForKey: (ws: string, key: string) => logs("idempotency_key = ?", ws, key),
    listForBatch: (ws: string, batchId: string) => logs("batch_id = ?", ws, batchId),
    listPending: (ws: string) =>
      logs(
        `outcome = 'pending' AND NOT EXISTS (
           SELECT 1 FROM action_log o WHERE o.workspace_id = action_log.workspace_id
             AND o.idempotency_key = action_log.idempotency_key AND o.outcome <> 'pending')`,
        ws,
      ),
    list: (ws: string, p: { limit: number; cursor?: string }) =>
      guard(() => {
        const after = p.cursor === undefined ? undefined : decodeCursor(p.cursor, 1)[0];
        const limit = Math.max(1, Math.floor(p.limit));
        const rows = all(
          `SELECT * FROM action_log WHERE workspace_id = ? ${after === undefined ? "" : "AND seq > ?"}
           ORDER BY seq LIMIT ?`,
          ws,
          ...(after === undefined ? [] : [after]),
          limit + 1,
        );
        return page(rows, limit, logOf, (r) => [num(r.seq)]);
      }),
    append: (e: z.infer<typeof actionLogSchema>) =>
      guard(() => {
        const v = actionLogSchema.parse(e);
        const owner = one(
          "SELECT account_id FROM message WHERE workspace_id = ? AND id = ?",
          v.workspaceId,
          v.command.messageIds[0],
        );
        // A plain INSERT: an id that already exists fails instead of rewriting history.
        run(
          `INSERT INTO action_log (workspace_id, id, action_id, idempotency_key, batch_id, outcome, account_id,
             command_kind, message_count, inverse_kind, command, inverse,
             irreversible, irreversible_reason, error_code, denial_reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          v.workspaceId,
          v.id,
          v.actionId,
          v.idempotencyKey,
          v.batchId ?? null,
          v.outcome,
          owner === undefined ? null : text(owner.account_id),
          v.command.kind,
          v.command.messageIds.length,
          v.inverse === null ? null : v.inverse.kind,
          JSON.stringify(v.command),
          v.inverse === null ? null : JSON.stringify(v.inverse),
          v.irreversible ? 1 : 0,
          v.irreversibleReason ?? null,
          v.errorCode ?? null,
          v.denialReason ?? null,
          v.at,
        );
        if (
          (v.outcome === "applied" || v.outcome === "undone") &&
          (v.command.kind === "archive" || v.command.kind === "unarchive")
        ) {
          archiveMarker.run(
            v.command.kind === "archive" ? 1 : 0,
            v.workspaceId,
            JSON.stringify(v.command),
          );
        }
      }),
  };

  return actionLog;
}
