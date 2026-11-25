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
  /** Every entry (applied, failed, refused) recorded for the key, in write order. */
  listForKey(
    ws: WorkspaceId,
    idempotencyKey: string,
  ): AsyncResult<readonly ActionLog[], StorageError>;
  /** Every entry of a batch, in write order, so undo can reverse the whole batch after a restart. */
  listForBatch(ws: WorkspaceId, batchId: string): AsyncResult<readonly ActionLog[], StorageError>;
  /** The sequence number of the workspace's last entry (0 when empty): the mark a start records. */
  lastSeq(ws: WorkspaceId): AsyncResult<number, StorageError>;
  /**
   * `pending` entries written at or before `bootSeq` (`lastSeq` at the start of this process)
   * with no later `applied`, `failed`, `undone` or `refused` entry for the same key, later
   * meaning a greater sequence number, never the wall clock: the provider call may have happened
   * without being recorded. A retry after a failure writes a new `pending`, which counts again.
   * Later entries belong to actions running now and are never listed, so recovery cannot replay
   * them. Oldest first.
   *
   * Recovery replays what this lists, with two rules: a cancelled action is closed `failed`
   * (`action.outcome_unknown`) and never replayed; every entry gets one replay, and one whose
   * replay fails transiently (provider offline, rate limited, auth expired, `provider.failed`)
   * after `MAX_REPLAY_AGE_MS` is closed `failed` with `action.replay_expired`.
   */
  listPending(ws: WorkspaceId, bootSeq: number): AsyncResult<readonly ActionLog[], StorageError>;
  /** Every row in write order: one action yields its `pending` row and its final row. */
  list(ws: WorkspaceId, page: PageRequest): AsyncResult<Page<ActionLog>, StorageError>;
}
export interface ActionLogWriter {
  /** The log is append-only: undo appends an `undone` entry, it never edits or removes one. */
  append(entry: ActionLog): AsyncResult<void, StorageError>;
}
export type ActionLogRepository = ActionLogReader & ActionLogWriter;
