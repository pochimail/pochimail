import type { AsyncResult, CancelSignal, Page, PageRequest } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, TopicId, WorkspaceId } from "@pochimail/kernel/ids";
import type { IncomingMessage, Message } from "../model/message.ts";

// Every method takes the workspaceId first: all reads and writes are workspace-scoped.
// `category` is an opaque label here: classification owns its meaning.

export interface MessageQuery extends PageRequest {
  readonly accountId: AccountId;
  readonly category?: string;
  readonly senderAddress?: string;
  /** Only messages stored after this ingest sequence (see `latestSequence`). */
  readonly afterSequence?: number;
  /** Only messages stored up to and including this ingest sequence. */
  readonly throughSequence?: number;
}
export interface MessageReader {
  get(ws: WorkspaceId, id: MessageId): AsyncResult<Message, StorageError | NotFound>;
  query(
    ws: WorkspaceId,
    query: MessageQuery,
    signal?: CancelSignal,
  ): AsyncResult<Page<Message>, StorageError>;
  /**
   * The ingest sequence of the last message stored for the account (0 when none). It grows with
   * every first insert, whatever the message's own date, so "stored since" never misses late mail.
   */
  latestSequence(ws: WorkspaceId, accountId: AccountId): AsyncResult<number, StorageError>;
  /** Emails per category over the given accounts, one aggregate read (a label with no message may be absent). */
  countByCategory(
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<Readonly<Record<string, number>>, StorageError>;
  /** Emails per topic id over the given accounts, one aggregate read (a topic with no message may be absent). */
  countByTopic(
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<Readonly<Record<string, number>>, StorageError>;
}
export interface MessageWriter {
  /** Inserts or updates by id; a re-run with the same input changes nothing (idempotent). */
  upsertMany(
    messages: readonly IncomingMessage[],
    signal?: CancelSignal,
  ): AsyncResult<void, StorageError>;
  setCategory(
    ws: WorkspaceId,
    id: MessageId,
    category: string,
  ): AsyncResult<void, StorageError | NotFound>;
  /** Replaces the topics of the message. A re-sync keeps them, like the category. */
  setTopics(
    ws: WorkspaceId,
    id: MessageId,
    topicIds: readonly TopicId[],
  ): AsyncResult<void, StorageError | NotFound>;
}

export type MessageRepository = MessageReader & MessageWriter;
