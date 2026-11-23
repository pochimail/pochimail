import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { incomingMessageSchema } from "@pochimail/mailbox/model/message";
import type { FixtureMessage } from "../fixture-mailbox/mailbox-reader.ts";
import type { RecordedEntry, Recording } from "./http-replay.ts";

// DEV/TEST ONLY. Synthetic Gmail- and Graph-shaped traffic generated from the fixture mailbox,
// plus tiny reference readers that prove the recording carries the whole mailbox. Real adapters
// run the same contract (`protocol-contract.ts`) against their own code.

export interface MailboxIds {
  readonly accountId: string;
  readonly workspaceId: string;
}

export const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me";
const UNSUBSCRIBE_VALUE = "<mailto:unsubscribe@list.example.net>";
// Graph has no size field on a message: PR_MESSAGE_SIZE (0x0FF8) through extended properties
// is the documented way, and attachments arrive through `$expand` (#114).
const GRAPH_SIZE_PROPERTY = "Integer 0x0FF8";
const GRAPH_EXPAND = `attachments,singleValueExtendedProperties($filter=id eq '${GRAPH_SIZE_PROPERTY}')`;
const graphUrl = (size: number, token?: string) =>
  `${GRAPH_BASE}/messages?${new URLSearchParams({
    $top: String(size),
    $expand: GRAPH_EXPAND,
    ...(token ? { $skiptoken: token } : {}),
  })}`;

const ok = (body: unknown): RecordedEntry["response"] => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const page = <T>(items: readonly T[], size: number): T[][] => {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length === 0 ? [[]] : pages;
};

export interface WireOptions {
  readonly pageSize?: number;
}

/** `users.messages.list` pages plus one `messages.get?format=metadata` per message. */
export function gmailRecording(
  messages: readonly FixtureMessage[],
  options: WireOptions = {},
): Recording {
  const size = options.pageSize ?? 100;
  const entries: RecordedEntry[] = [];
  const pages = page(messages, size);
  pages.forEach((items, index) => {
    const query = new URLSearchParams({ maxResults: String(size) });
    if (index > 0) query.set("pageToken", `page-${index}`);
    const body: Record<string, unknown> = {
      messages: items.map(({ message }) => ({ id: message.id, threadId: message.threadId })),
    };
    if (index < pages.length - 1) body.nextPageToken = `page-${index + 1}`;
    entries.push({
      request: { method: "GET", url: `${GMAIL_BASE}/messages?${query}` },
      response: ok(body),
    });
  });
  for (const { message, attachments } of messages) {
    entries.push({
      request: {
        method: "GET",
        url: `${GMAIL_BASE}/messages/${encodeURIComponent(message.id)}?format=metadata`,
      },
      response: ok({
        id: message.id,
        threadId: message.threadId,
        labelIds: message.opened ? ["INBOX"] : ["INBOX", "UNREAD"],
        snippet: message.snippet,
        internalDate: String(Date.parse(message.receivedAt)),
        sizeEstimate: message.size,
        payload: {
          headers: [
            { name: "From", value: message.from },
            { name: "To", value: message.to.join(", ") },
            { name: "Subject", value: message.subject },
            ...(message.hasListUnsubscribe
              ? [{ name: "List-Unsubscribe", value: UNSUBSCRIBE_VALUE }]
              : []),
          ],
          // Numbers only: an attachment part is its size and an opaque id, never a name (ADR 0014).
          parts: attachments.map((a, i) => ({
            mimeType: a.mimeType,
            body: { attachmentId: `att-${i}`, size: a.size },
          })),
        },
      }),
    });
  }
  return { version: 1, entries };
}

/** `GET /me/messages` pages linked by `@odata.nextLink`, as Graph sends them. */
export function graphRecording(
  messages: readonly FixtureMessage[],
  options: WireOptions = {},
): Recording {
  const size = options.pageSize ?? 100;
  const pages = page(messages, size);
  return {
    version: 1,
    entries: pages.map((items, index) => ({
      request: { method: "GET", url: graphUrl(size, index > 0 ? `page-${index}` : undefined) },
      response: ok({
        value: items.map(({ message, attachments }) => ({
          id: message.id,
          conversationId: message.threadId,
          subject: message.subject,
          bodyPreview: message.snippet,
          receivedDateTime: message.receivedAt,
          isRead: message.opened,
          from: { emailAddress: { address: message.from } },
          toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
          internetMessageHeaders: message.hasListUnsubscribe
            ? [{ name: "List-Unsubscribe", value: UNSUBSCRIBE_VALUE }]
            : [],
          // Numbers only, never an attachment name (ADR 0014).
          attachments: attachments.map((a) => ({
            size: a.size,
            contentType: a.mimeType,
            isInline: false,
          })),
          singleValueExtendedProperties: [{ id: GRAPH_SIZE_PROPERTY, value: String(message.size) }],
        })),
        ...(index < pages.length - 1
          ? { "@odata.nextLink": graphUrl(size, `page-${index + 1}`) }
          : {}),
      }),
    })),
  };
}

/** The slice of the egress `HttpClient` the readers need, so this package never imports `mail`. */
export interface WireHttp {
  request(request: {
    url: string;
  }): Promise<
    | { readonly ok: true; readonly value: { readonly status: number; readonly body: string } }
    | { readonly ok: false; readonly error: Error }
  >;
}

async function getJson(http: WireHttp, url: string): Promise<Record<string, unknown>> {
  const result = await http.request({ url });
  if (!result.ok) throw result.error;
  if (result.value.status !== 200) throw new Error(`HTTP ${result.value.status}`);
  return JSON.parse(result.value.body) as Record<string, unknown>;
}

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

export async function readGmailMailbox(
  http: WireHttp,
  ids: MailboxIds,
  pageSize = 100,
): Promise<IncomingMessage[]> {
  const out: IncomingMessage[] = [];
  let token = "";
  for (let guard = 0; guard < 1000; guard++) {
    const query = new URLSearchParams({ maxResults: String(pageSize) });
    if (token) query.set("pageToken", token);
    const list = await getJson(http, `${GMAIL_BASE}/messages?${query}`);
    for (const ref of rows(list.messages)) {
      const raw = await getJson(
        http,
        `${GMAIL_BASE}/messages/${encodeURIComponent(text(ref.id))}?format=metadata`,
      );
      const payload = raw.payload as Row | undefined;
      const headers = new Map(rows(payload?.headers).map((h) => [text(h.name), text(h.value)]));
      // A part with an attachmentId is an attachment; its body.size is the provider's report (#114).
      const parts = rows(payload?.parts).filter(
        (p) => text((p.body as Row | undefined)?.attachmentId) !== "",
      );
      out.push(
        incomingMessageSchema.parse({
          schemaVersion: 1,
          id: text(raw.id),
          workspaceId: ids.workspaceId,
          accountId: ids.accountId,
          threadId: text(raw.threadId),
          from: headers.get("From"),
          to: (headers.get("To") ?? "").split(", "),
          subject: headers.get("Subject"),
          snippet: text(raw.snippet),
          receivedAt: new Date(Number(raw.internalDate)).toISOString(),
          hasListUnsubscribe: headers.has("List-Unsubscribe"),
          opened: !Array.isArray(raw.labelIds) || !raw.labelIds.includes("UNREAD"),
          size: num(raw.sizeEstimate),
          savedCount: parts.length,
          savedSize: parts.reduce((sum, p) => sum + num((p.body as Row).size), 0),
          topicIds: [],
        }),
      );
    }
    token = text(list.nextPageToken);
    if (!token) return out;
  }
  throw new Error("Gmail listing never finished");
}

export async function readGraphMailbox(
  http: WireHttp,
  ids: MailboxIds,
  pageSize = 100,
): Promise<IncomingMessage[]> {
  const out: IncomingMessage[] = [];
  let url: string | null = graphUrl(pageSize);
  for (let guard = 0; url !== null && guard < 1000; guard++) {
    const body: Row = await getJson(http, url);
    for (const m of rows(body.value)) {
      const address = (party: unknown) => text(((party as Row).emailAddress as Row).address);
      const attachments = rows(m.attachments);
      const sizeProperty = rows(m.singleValueExtendedProperties).find(
        (p) => text(p.id) === GRAPH_SIZE_PROPERTY,
      );
      out.push(
        incomingMessageSchema.parse({
          schemaVersion: 1,
          id: text(m.id),
          workspaceId: ids.workspaceId,
          accountId: ids.accountId,
          threadId: text(m.conversationId),
          from: address(m.from),
          to: rows(m.toRecipients).map(address),
          subject: text(m.subject),
          snippet: text(m.bodyPreview),
          receivedAt: new Date(text(m.receivedDateTime)).toISOString(),
          hasListUnsubscribe: rows(m.internetMessageHeaders).some(
            (h) => text(h.name).toLowerCase() === "list-unsubscribe",
          ),
          opened: m.isRead === true,
          size: Number(text(sizeProperty?.value)),
          savedCount: attachments.length,
          savedSize: attachments.reduce((sum, a) => sum + num(a.size), 0),
          topicIds: [],
        }),
      );
    }
    const next: string = text(body["@odata.nextLink"]);
    url = next === "" ? null : next;
  }
  return out;
}
