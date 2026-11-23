import { type IncomingMessage, incomingMessageSchema } from "@pochimail/mailbox/model/message";
import { decodeHeaderText, readContent, splitMbox } from "./mbox.ts";

export interface FixtureMessage {
  readonly message: IncomingMessage;
  /** Decoded plain text, what `fetchBody` returns. */
  readonly body: string;
  readonly attachments: readonly {
    readonly filename: string;
    readonly mimeType: string;
    readonly size: number;
  }[];
}

const address = (header: string): string => /<([^>]+)>/.exec(header)?.[1] ?? header.trim();

function snippet(text: string): string {
  const lines = text.split("\n").filter((line) => !line.startsWith(">"));
  return [...lines.join(" ").replace(/\s+/g, " ").trim()].slice(0, 120).join("");
}

/** Reads a fixture mbox into validated `IncomingMessage`s, in file order. Throws on a malformed fixture. */
export function readMailbox(
  mbox: string,
  ids: { readonly accountId: string; readonly workspaceId: string },
): FixtureMessage[] {
  return splitMbox(mbox).map((raw) => {
    const header = (name: string) => raw.headers.get(name) ?? "";
    const content = readContent(raw);
    const savedSize = content.attachments.reduce((sum, a) => sum + a.size, 0);
    const message = incomingMessageSchema.parse({
      schemaVersion: 1,
      id: header("message-id").replace(/^<|>$/g, ""),
      workspaceId: ids.workspaceId,
      accountId: ids.accountId,
      threadId: header("x-thread-id"),
      from: address(header("from")),
      to: header("to").split(",").map(address),
      subject: decodeHeaderText(header("subject")),
      snippet: snippet(content.text),
      receivedAt: new Date(Date.parse(header("date"))).toISOString(),
      hasListUnsubscribe: raw.headers.has("list-unsubscribe"),
      opened: header("status").includes("R"),
      // Known facts, always reported (#114): raw bytes plus the documents' declared sizes,
      // standing in for the provider's estimate of the whole message.
      size: raw.size + savedSize,
      savedCount: content.attachments.length,
      savedSize,
      topicIds: [],
    });
    return { message, body: content.text, attachments: content.attachments };
  });
}
