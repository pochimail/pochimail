import type { AsyncResult } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import type { ClassifiableMessage, SignalFacts } from "../model/message-facts.ts";

/** Read access to the mailbox's messages as plain data; the adapter maps from the mailbox rows. */
export interface MessageSource extends UnclassifiedSource {
  get(ws: WorkspaceId, id: MessageId): AsyncResult<ClassifiableMessage, StorageError | NotFound>;
  /** Emails per stored label for the given accounts; a label with no email may be absent. */
  countByCategory(
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<Readonly<Record<string, number>>, StorageError>;
}

/** Stored messages of an account that no classification was recorded for, so mail synced after the first scan is found. */
export interface UnclassifiedSource {
  /**
   * Ids of the account's messages that have no derived decision, in id order, at most `limit`. A message stops
   * being listed once it is classified, so a crash between sync and classify is repaired by the next call.
   */
  listUnclassified(
    ws: WorkspaceId,
    accountId: AccountId,
    limit: number,
  ): AsyncResult<readonly MessageId[], StorageError>;
}

export interface MessageLabeler {
  /** Records the category on the stored message. */
  setCategory(
    ws: WorkspaceId,
    id: MessageId,
    category: string,
  ): AsyncResult<void, StorageError | NotFound>;
}

export interface SignalFactsSource {
  /**
   * Facts of each given message of `accountId`, in id order; a message of another account is left
   * out. `NotFound` when the account or a message does not exist.
   */
  forMessages(
    ws: WorkspaceId,
    accountId: AccountId,
    ids: readonly MessageId[],
  ): AsyncResult<readonly SignalFacts[], StorageError | NotFound>;
}
