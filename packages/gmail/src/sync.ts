import type { MailProviderError } from "@pochimail/actions/ports/mail-commands";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { ProviderFailed } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import type { SyncBatch, SyncCursor } from "@pochimail/mailbox/ports/mail-reader";
import { GMAIL_QUOTA_UNITS } from "@pochimail/net/egress/rate-limit";
import {
  EXTRA_QUOTA_UNITS,
  historySchema,
  messageListSchema,
  metadataSchema,
  profileSchema,
} from "./api.ts";
import type { GmailClient } from "./client.ts";
import { decodeCursor, encodeCursor, type GmailPosition } from "./cursor.ts";
import { type Identity, SYNC_HEADERS, toIncoming } from "./mapping.ts";

/** Quota units one sync batch may spend; the page size follows from it (list + one get per id). */
export const SYNC_BATCH_QUOTA_UNITS = 1_000;
const METADATA_FIELDS =
  "id,threadId,labelIds,sizeEstimate,internalDate,payload/mimeType,payload/headers,payload/parts/filename";

export interface GmailSyncOptions {
  /** Messages per batch. Default: as many as `SYNC_BATCH_QUOTA_UNITS` pays for. */
  readonly pageSize?: number;
  /** Metadata gets in flight at once. Default 10. */
  readonly concurrency?: number;
}

type Step = AsyncResult<SyncBatch, MailProviderError>;

/**
 * Backfill newest to oldest with `messages.list`, then deltas with `history.list`. A history id
 * Gmail no longer keeps (404) restarts a full listing, flagged `restarted`. Only ids, dates,
 * labels, size and three headers are requested: no request names a subject, snippet or body.
 */
export class GmailSync {
  private readonly pageSize: number;
  private readonly concurrency: number;

  constructor(
    private readonly client: GmailClient,
    private readonly identity: Identity,
    options: GmailSyncOptions = {},
  ) {
    this.pageSize =
      options.pageSize ??
      Math.floor(
        (SYNC_BATCH_QUOTA_UNITS - GMAIL_QUOTA_UNITS.messagesList) / GMAIL_QUOTA_UNITS.messagesGet,
      );
    this.concurrency = options.concurrency ?? 10;
  }

  execute(cursor: SyncCursor | null, signal: CancelSignal): Step {
    const position = decodeCursor(cursor);
    if (position === null) return this.startBackfill(false, signal);
    if (position.kind === "backfill") return this.backfillPage(position, false, signal);
    return this.historyPage(position, signal);
  }

  private async startBackfill(restarted: boolean, signal: CancelSignal): Step {
    const profile = await this.client.call({
      path: "profile",
      cost: EXTRA_QUOTA_UNITS.profile,
      signal,
    });
    if (!profile.ok) return profile;
    const parsed = profileSchema.safeParse(profile.value.json);
    if (!parsed.success) return err(new ProviderFailed("Unexpected Gmail profile"));
    return this.backfillPage(
      { kind: "backfill", startHistoryId: parsed.data.historyId, pageToken: "" },
      restarted,
      signal,
    );
  }

  private async backfillPage(
    position: Extract<GmailPosition, { kind: "backfill" }>,
    restarted: boolean,
    signal: CancelSignal,
  ): Step {
    const listed = await this.client.call({
      path: "messages",
      query: {
        maxResults: this.pageSize,
        ...(position.pageToken === "" ? {} : { pageToken: position.pageToken }),
      },
      cost: GMAIL_QUOTA_UNITS.messagesList,
      signal,
    });
    if (!listed.ok) return listed;
    const parsed = messageListSchema.safeParse(listed.value.json);
    if (!parsed.success) return err(new ProviderFailed("Unexpected Gmail message list"));
    const messages = await this.metadata(
      parsed.data.messages.map((m) => m.id),
      signal,
    );
    if (!messages.ok) return messages;
    const next = parsed.data.nextPageToken;
    return ok({
      messages: messages.value,
      nextCursor: encodeCursor(
        next === undefined
          ? { kind: "history", historyId: position.startHistoryId, pageToken: "" }
          : { ...position, pageToken: next },
      ),
      hasMore: next !== undefined,
      restarted,
    });
  }

  private async historyPage(
    position: Extract<GmailPosition, { kind: "history" }>,
    signal: CancelSignal,
  ): Step {
    const listed = await this.client.call({
      path: "history",
      query: {
        startHistoryId: position.historyId,
        historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
        ...(position.pageToken === "" ? {} : { pageToken: position.pageToken }),
      },
      cost: GMAIL_QUOTA_UNITS.historyList,
      signal,
    });
    if (!listed.ok) return listed;
    // Gmail no longer keeps that history id: list everything again; stored rows are rewritten as is.
    if (listed.value.status === 404) return this.startBackfill(true, signal);
    const parsed = historySchema.safeParse(listed.value.json);
    if (!parsed.success) return err(new ProviderFailed("Unexpected Gmail history"));
    // New mail and label changes (read, archive, labels made in Gmail) are both re-read, so the
    // stored flags never go stale; the metadata get is the authority.
    const added = [
      ...new Set(
        parsed.data.history.flatMap((h) =>
          [...h.messagesAdded, ...h.labelsAdded, ...h.labelsRemoved].map((c) => c.message.id),
        ),
      ),
    ];
    const messages = await this.metadata(added, signal);
    if (!messages.ok) return messages;
    const next = parsed.data.nextPageToken;
    return ok({
      messages: messages.value,
      nextCursor: encodeCursor({
        kind: "history",
        historyId: next === undefined ? parsed.data.historyId : position.historyId,
        pageToken: next ?? "",
      }),
      hasMore: next !== undefined,
      restarted: false,
    });
  }

  /** Metadata for these ids, a few at a time; a message deleted since listing is skipped. */
  private async metadata(
    ids: readonly string[],
    signal: CancelSignal,
  ): AsyncResult<IncomingMessage[], MailProviderError> {
    const out: IncomingMessage[] = [];
    for (let i = 0; i < ids.length; i += this.concurrency) {
      const chunk = ids.slice(i, i + this.concurrency);
      const replies = await Promise.all(
        chunk.map((id) =>
          this.client.call({
            path: `messages/${encodeURIComponent(id)}`,
            query: { format: "metadata", metadataHeaders: SYNC_HEADERS, fields: METADATA_FIELDS },
            cost: GMAIL_QUOTA_UNITS.messagesGet,
            signal,
          }),
        ),
      );
      for (const reply of replies) {
        if (!reply.ok) return reply;
        if (reply.value.status === 404) continue;
        const parsed = metadataSchema.safeParse(reply.value.json);
        if (!parsed.success) continue;
        const mapped = toIncoming(parsed.data, this.identity);
        if (mapped !== null) out.push(mapped);
      }
    }
    return ok(out);
  }
}
