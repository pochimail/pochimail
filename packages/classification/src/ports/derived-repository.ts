import type { AsyncResult, Page, PageRequest } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import type { DerivedMessage } from "../model/derived.ts";

// Every method takes the workspaceId first: all reads and writes are workspace-scoped.

export interface DerivedReader {
  get(ws: WorkspaceId, id: MessageId): AsyncResult<DerivedMessage, StorageError | NotFound>;
  /** The rows of these messages in one read; a message without one is left out. */
  listForMessages(
    ws: WorkspaceId,
    ids: readonly MessageId[],
  ): AsyncResult<readonly DerivedMessage[], StorageError>;
  list(
    ws: WorkspaceId,
    accountId: AccountId,
    page: PageRequest,
  ): AsyncResult<Page<DerivedMessage>, StorageError>;
}
export interface DerivedWriter {
  /** One row per message: saving again replaces it, so a re-run changes nothing. */
  save(derived: DerivedMessage): AsyncResult<void, StorageError>;
}
export type DerivedRepository = DerivedReader & DerivedWriter;
