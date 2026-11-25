import type { AsyncResult, Page, PageRequest } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import type { SenderStats } from "../model/sender-stats.ts";

/** What is known of one stored message's sender without reading an address (ADR 0014). */
export interface SenderOfMessage {
  /** Whether the message was sent by `ownerAddress`; `undefined` when its sender is unknown. */
  readonly fromOwner: boolean | undefined;
  /** The sender's statistics; `undefined` for a sender never seen or unknown. */
  readonly stats: SenderStats | undefined;
}

export interface SenderReader {
  get(
    ws: WorkspaceId,
    accountId: AccountId,
    address: string,
  ): AsyncResult<SenderStats, StorageError | NotFound>;
  list(
    ws: WorkspaceId,
    accountId: AccountId,
    page: PageRequest,
  ): AsyncResult<Page<SenderStats>, StorageError>;
  /** Computed from what was stored at ingest, so it still answers after the display address is gone. */
  ofMessage(
    ws: WorkspaceId,
    id: MessageId,
    ownerAddress: string,
  ): AsyncResult<SenderOfMessage, StorageError | NotFound>;
}
export interface SenderWriter {
  upsert(stats: SenderStats): AsyncResult<void, StorageError>;
}

export type SenderRepository = SenderReader & SenderWriter;
