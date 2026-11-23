// RFC 4155/mboxrd file format plus the MIME bits the fixture uses. The writer emits pure ASCII
// (encoded-words, quoted-printable, base64), so an mbox is a plain string and never depends on
// the platform's default encoding. FAKE DATA ONLY.

export type Charset = "utf-8" | "iso-8859-1" | "us-ascii";

function bytesOf(text: string, charset: Charset): Uint8Array {
  if (charset === "iso-8859-1") return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  return new TextEncoder().encode(text);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines;
}

export function encodeBase64Body(bytes: Uint8Array): string {
  return wrap(toBase64(bytes), 76).join("\n");
}

export function encodeQuotedPrintable(text: string, charset: Charset): string {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    let line = "";
    for (const byte of bytesOf(rawLine, charset)) {
      const piece =
        byte === 0x3d || byte < 0x20 || byte > 0x7e
          ? `=${byte.toString(16).toUpperCase().padStart(2, "0")}`
          : String.fromCharCode(byte);
      if (line.length + piece.length > 75) {
        out.push(`${line}=`);
        line = "";
      }
      line += piece;
    }
    // A trailing space would be stripped in transit: encode it.
    out.push(line.replace(/ $/, "=20"));
  }
  return out.join("\n");
}

/** RFC 2047 encoded-word(s) for a header value; ASCII text passes through. */
export function encodeHeaderText(text: string, charset: Charset): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = "";
  const flush = () => {
    if (chunk === "") return;
    words.push(
      charset === "iso-8859-1"
        ? `=?ISO-8859-1?Q?${[...bytesOf(chunk, charset)]
            .map((b) =>
              b > 0x20 && b < 0x7f && !"=?_".includes(String.fromCharCode(b))
                ? String.fromCharCode(b)
                : b === 0x20
                  ? "_"
                  : `=${b.toString(16).toUpperCase().padStart(2, "0")}`,
            )
            .join("")}?=`
        : `=?UTF-8?B?${toBase64(bytesOf(chunk, "utf-8"))}?=`,
    );
    chunk = "";
  };
  for (const char of text) {
    // 30 bytes of UTF-8 keeps every encoded-word under the 75 character limit.
    if (bytesOf(chunk + char, charset).length > (charset === "utf-8" ? 30 : 20)) flush();
    chunk += char;
  }
  flush();
  return words.join("\n ");
}

const WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeHeaderText(value: string): string {
  const unfolded = value.replace(/\r?\n[ \t]+/g, " ");
  // Whitespace between two adjacent encoded-words is not part of the text (RFC 2047 §6.2).
  const joined = unfolded.replace(/(\?=)\s+(?==\?)/g, "$1");
  return joined.replace(WORD, (_all, charset: string, enc: string, payload: string) => {
    const bytes =
      enc.toUpperCase() === "B"
        ? Uint8Array.from(Buffer.from(payload, "base64"))
        : decodeQuotedPrintableBytes(payload.replace(/_/g, " "));
    return decodeBytes(bytes, charset);
  });
}

function decodeQuotedPrintableBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(char.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
}

export function decodeQuotedPrintable(text: string, charset: string): string {
  // `=\n` is a soft line break.
  return decodeBytes(decodeQuotedPrintableBytes(text.replace(/=\n/g, "")), charset);
}

export function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text.replace(/\s+/g, ""), "base64"));
}

/** mboxrd: a body line `From ` (or `>From `, `>>From `…) gets one more `>` so it is not a separator. */
export function quoteFromLines(body: string): string {
  return body.replace(/^(>*From )/gm, ">$1");
}

export function unquoteFromLines(body: string): string {
  return body.replace(/^>(>*From )/gm, "$1");
}

export interface RawMessage {
  readonly headers: ReadonlyMap<string, string>;
  /** Everything after the blank line, `>From ` escaping already undone. */
  readonly body: string;
  /** Size of the raw message in bytes, the fixture's stand-in for the provider's size estimate. */
  readonly size: number;
}

/** The raw text of each message in an mbox (`\n` line ends, `>From ` escaping not yet undone). */
export function splitMboxRaw(mbox: string): string[] {
  const messages: string[] = [];
  let current: string[] | null = null;
  const finish = () => {
    if (current) messages.push(current.join("\n"));
  };
  for (const line of mbox.split("\n")) {
    if (line.startsWith("From ")) {
      finish();
      current = [];
    } else current?.push(line);
  }
  finish();
  return messages;
}

/** Splits an mbox into messages. Header names are lower-cased; folded lines are unfolded. */
export function splitMbox(mbox: string): RawMessage[] {
  return splitMboxRaw(mbox).map(parseRaw);
}

function parseRaw(raw: string): RawMessage {
  const split = raw.indexOf("\n\n");
  const head = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? "" : raw.slice(split + 2);
  const headers = new Map<string, string>();
  for (const line of head.replace(/\n[ \t]+/g, "\n ").split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0)
      headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).replace(/^\s+/, ""));
  }
  return { headers, body: unquoteFromLines(body.replace(/\n$/, "")), size: Buffer.byteLength(raw) };
}

function parameter(contentType: string, name: string): string | undefined {
  return new RegExp(`${name}="?([^";\\s]+)"?`, "i").exec(contentType)?.[1];
}

function decodePart(headers: ReadonlyMap<string, string>, body: string): string {
  const charset = parameter(headers.get("content-type") ?? "", "charset") ?? "us-ascii";
  const encoding = (headers.get("content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  if (encoding === "base64") return decodeBytes(decodeBase64(body), charset);
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body, charset);
  return body;
}

export interface MessageContent {
  readonly text: string;
  readonly attachments: readonly {
    readonly filename: string;
    readonly mimeType: string;
    /** Size in bytes: the declared RFC 2183 `size` when present, else the decoded body (#114). */
    readonly size: number;
  }[];
}

/** Decodes the plain-text body (and lists attachments) of a message, whatever its encoding. */
export function readContent(message: RawMessage): MessageContent {
  const type = message.headers.get("content-type") ?? "text/plain";
  const boundary = type.toLowerCase().startsWith("multipart/") ? parameter(type, "boundary") : null;
  if (!boundary) return { text: decodePart(message.headers, message.body), attachments: [] };
  let text = "";
  const attachments: { filename: string; mimeType: string; size: number }[] = [];
  for (const part of message.body.split(`--${boundary}`).slice(1)) {
    if (part.startsWith("--")) break;
    const parsed = parseRaw(part.replace(/^\n/, ""));
    const partType = parsed.headers.get("content-type") ?? "text/plain";
    const disposition = parsed.headers.get("content-disposition") ?? "";
    const filename = parameter(disposition, "filename");
    if (filename) {
      // Fixture attachment bodies are base64 stubs; the declared size is the document's real size.
      const declared = parameter(disposition, "size");
      attachments.push({
        filename,
        mimeType: partType.split(";")[0]?.trim() ?? "",
        size: declared === undefined ? decodeBase64(parsed.body).length : Number(declared),
      });
    } else if (partType.toLowerCase().startsWith("text/plain"))
      text = decodePart(parsed.headers, parsed.body);
  }
  return { text, attachments };
}
