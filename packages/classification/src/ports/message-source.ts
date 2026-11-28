import type { AsyncResult } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, TopicId, WorkspaceId } from "@pochimail/kernel/ids";
import type { ClassifiableMessage, SignalFacts } from "../model/message-facts.ts";

/** Read access to the mailbox's messages as plain data; the adapter maps from the mailbox rows. */
export interface MessageSource {
  get(ws: WorkspaceId, id: MessageId): AsyncResult<ClassifiableMessage, StorageError | NotFound>;
  /** Emails per stored label for the given accounts; a label with no email may be absent. */
  countByCategory(
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<Readonly<Record<string, number>>, StorageError>;
  /** Emails per topic id for the given accounts; a topic with no email may be absent. */
  countByTopic(
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<Readonly<Record<string, number>>, StorageError>;
}

export interface MessageLabeler {
  /** Records the type on the stored message under its stored `category` label. */
  setCategory(
    ws: WorkspaceId,
    id: MessageId,
    category: string,
  ): AsyncResult<void, StorageError | NotFound>;
  /** Replaces the topics of the stored message; an empty list leaves it in none. */
  setTopics(
    ws: WorkspaceId,
    id: MessageId,
    topicIds: readonly TopicId[],
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
