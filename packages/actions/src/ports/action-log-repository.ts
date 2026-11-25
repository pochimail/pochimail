import type { AsyncResult, Page, PageRequest } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { ActionId, ActionLogId } from "../ids.ts";
import type { ActionLog } from "../model/action.ts";

// Every method takes the workspaceId first: all reads and writes are workspace-scoped.

export interface ActionLogReader {
  get(ws: WorkspaceId, id: ActionLogId): AsyncResult<ActionLog, StorageError | NotFound>;
  listForAction(
    ws: WorkspaceId,
    actionId: ActionId,
  ): AsyncResult<readonly ActionLog[], StorageError>;
  /** Every entry (applied, failed, refused) recorded for the key, oldest first. */
  listForKey(
    ws: WorkspaceId,
    idempotencyKey: string,
  ): AsyncResult<readonly ActionLog[], StorageError>;
  /** Every entry of a batch, oldest first, so undo can reverse the whole batch after a restart. */
  listForBatch(ws: WorkspaceId, batchId: string): AsyncResult<readonly ActionLog[], StorageError>;
  /**
   * `pending` entries written before `before` (the start time of this process) with no later
   * `applied`, `failed`, `undone` or `refused` entry for the same key, later meaning greater
   * `(at, seq)`: the provider call may have happened without being recorded. A retry after a
   * failure writes a new `pending`, which counts again. Entries from `before` on belong to
   * actions running now and are never listed, so recovery cannot replay them. Oldest first.
   *
   * Recovery replays what this lists, with two rules: a cancelled action is closed `failed`
   * (`operation.cancelled`) when it is cancelled and never replayed; a replay that stays
   * deferred (provider offline, rate limited, auth expired, `provider.failed`) is given up
   * after `MAX_REPLAY_AGE_MS`, closed `failed` with `action.replay_expired`.
   */
  listPending(ws: WorkspaceId, before: string): AsyncResult<readonly ActionLog[], StorageError>;
  /** Every row in write order: one action yields its `pending` row and its final row. */
  list(ws: WorkspaceId, page: PageRequest): AsyncResult<Page<ActionLog>, StorageError>;
}
export interface ActionLogWriter {
  /** The log is append-only: undo appends an `undone` entry, it never edits or removes one. */
  append(entry: ActionLog): AsyncResult<void, StorageError>;
}
export type ActionLogRepository = ActionLogReader & ActionLogWriter;
