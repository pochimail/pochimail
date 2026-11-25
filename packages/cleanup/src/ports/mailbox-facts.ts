import type { AsyncResult, Page } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";

/** One stored message as plain data: the label is an opaque string owned by classification. */
export interface MessageFact {
  readonly id: MessageId;
  /** The keyed sender digest, never the address (ADR 0014); empty when the sender is unknown. */
  readonly senderHash: string;
  readonly category: string;
  readonly receivedAt: string;
  readonly opened: boolean;
  readonly hasListUnsubscribe: boolean;
  /** The provider's size estimate in bytes, when it reported one. */
  readonly size?: number;
  /** How many attachments the message carries; a number only, never a name (ADR 0014). */
  readonly savedCount?: number;
  /** Their combined size in bytes, when the provider reported one. */
  readonly savedSize?: number;
}

export interface MessageFactsQuery {
  readonly accountId: AccountId;
  readonly limit: number;
  readonly cursor?: string;
  /** Only messages stored after this ingest sequence. */
  readonly afterSequence?: number;
  /** Only messages stored up to this ingest sequence. */
  readonly throughSequence?: number;
}

/** A signal found on a message; the kind is a label owned by classification. */
export interface SignalFact {
  readonly messageId: MessageId;
  readonly kind: string;
  /** How sure the detector is; under `UNSURE_BELOW` the signal only protects, it is not counted. */
  readonly confidence: number;
}

/** The decision recorded for a message: why it was classified as it was. */
export interface DecisionFact {
  readonly messageId: MessageId;
  readonly reason: string;
  readonly confidence: number;
}

/**
 * One account's Overview figures (#114), aggregated over its stored rows. Sizes are bytes;
 * a row whose size or attachment facts are unknown (stored before the provider reported them)
 * adds nothing to the sums, and an unknown archived marker is not counted as archived.
 */
export interface AccountFigures {
  readonly accountId: AccountId;
  /** Messages an applied archive action left out of the inbox. */
  readonly archived: number;
  /** Attachments the stored messages carry; a count only, never a name (ADR 0014). */
  readonly savedCount: number;
  /** Their combined size in bytes. */
  readonly savedSize: number;
  /** Size of the messages whose latest executed trash/untrash effect is trash (ADR 0012). */
  readonly deletableSize: number;
  /** Applied unsubscribe actions; one entry is one sender. */
  readonly unsubscribed: number;
  /** Combined size of the stored messages, for "out of Y GB". */
  readonly totalSize: number;
}

/** What cleanup reads about mail, as plain data. The adapter maps it from the other domains' rows. */
export interface MailboxFacts {
  accountIds(ws: WorkspaceId): AsyncResult<readonly AccountId[], StorageError>;
  /** Newest first, like the mailbox listing. */
  query(ws: WorkspaceId, q: MessageFactsQuery): AsyncResult<Page<MessageFact>, StorageError>;
  /** The newest ingest sequence of the account; 0 when it has no mail. */
  latestSequence(ws: WorkspaceId, accountId: AccountId): AsyncResult<number, StorageError>;
  /** One figures row per selected account that has stored mail; an account without mail is left out. */
  figures(
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<readonly AccountFigures[], StorageError>;
  /** The decisions recorded for these messages; a message without one is left out. */
  decisions(
    ws: WorkspaceId,
    ids: readonly MessageId[],
  ): AsyncResult<readonly DecisionFact[], StorageError | NotFound>;
  /** The signals of these messages of the account at `now`, in message id order. */
  signals(
    ws: WorkspaceId,
    accountId: AccountId,
    ids: readonly MessageId[],
    now: Date,
  ): AsyncResult<readonly SignalFact[], StorageError | NotFound>;
}
