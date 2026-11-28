import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { MessageId, ThreadId } from "@pochimail/kernel/ids";
import { type IncomingMessage, incomingMessageSchema } from "@pochimail/mailbox/model/message";
import type { GmailMetadata } from "./api.ts";

export interface Identity {
  readonly workspaceId: WorkspaceId;
  readonly accountId: AccountId;
}

/** The only headers sync asks for. Subject and snippet are never requested (ADR 0014). */
export const SYNC_HEADERS = ["From", "To", "List-Unsubscribe"] as const;

const ADDRESS = /<([^<>\s]+@[^<>\s]+)>|([^\s,<>";]+@[^\s,<>";]+)/g;

function addresses(value: string | undefined): string[] {
  if (value === undefined) return [];
  return [...value.matchAll(ADDRESS)].map((m) => (m[1] ?? m[2] ?? "").toLowerCase());
}

function header(message: GmailMetadata, name: string): string | undefined {
  return message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/**
 * Attachments the payload shows, or undefined when it cannot tell (unknown protects, see
 * `has-document`). Known: a named file at the top or in a top-level part (a lower bound, never a name),
 * a `multipart/mixed` body whose parts the metadata format leaves out (1), and the types that cannot
 * hold a file: `text/*` and `multipart/alternative` without a filename (0). Signed, report, encrypted,
 * related and `application/*` bodies stay unknown.
 */
function attachmentCount(payload: GmailMetadata["payload"]): number | undefined {
  const files = payload.parts.filter((p) => p.filename !== "").length;
  if (files > 0) return files;
  if (payload.filename !== "") return 1;
  const type = payload.mimeType.toLowerCase();
  if (type === "multipart/mixed") return 1;
  if (type.startsWith("text/") || type === "multipart/alternative") return 0;
  return undefined;
}

/**
 * Gmail metadata to the minimal mailbox record: ids, date, flags and the sender and recipients
 * (kept for grouping by sender). Subject and snippet stay empty until the record drops them
 * (Q-10). A message that does not fit the record is skipped, never half-stored.
 */
export function toIncoming(message: GmailMetadata, identity: Identity): IncomingMessage | null {
  const id = MessageId(message.id);
  const threadId = ThreadId(message.threadId);
  const [from] = addresses(header(message, "From"));
  const receivedMs = Number(message.internalDate);
  const saved = attachmentCount(message.payload);
  if (!id.ok || !threadId.ok || from === undefined || !Number.isFinite(receivedMs)) return null;
  const parsed = incomingMessageSchema.safeParse({
    schemaVersion: 1,
    id: id.value,
    workspaceId: identity.workspaceId,
    accountId: identity.accountId,
    threadId: threadId.value,
    from,
    to: addresses(header(message, "To")),
    subject: "",
    snippet: "",
    receivedAt: new Date(receivedMs).toISOString(),
    hasListUnsubscribe: header(message, "List-Unsubscribe") !== undefined,
    opened: !message.labelIds.includes("UNREAD"),
    ...(message.sizeEstimate === undefined ? {} : { size: message.sizeEstimate }),
    ...(saved === undefined ? {} : { savedCount: saved }),
    topicIds: [],
  });
  return parsed.success ? parsed.data : null;
}
