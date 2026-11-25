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
   * `pending` entries whose key has no later `applied`, `failed`, `undone` or `refused` entry: the
   * provider call may have happened without being recorded. Oldest first.
   */
  listPending(ws: WorkspaceId): AsyncResult<readonly ActionLog[], StorageError>;
  list(ws: WorkspaceId, page: PageRequest): AsyncResult<Page<ActionLog>, StorageError>;
}
export interface ActionLogWriter {
  /** The log is append-only: undo appends an `undone` entry, it never edits or removes one. */
  append(entry: ActionLog): AsyncResult<void, StorageError>;
}
export type ActionLogRepository = ActionLogReader & ActionLogWriter;
