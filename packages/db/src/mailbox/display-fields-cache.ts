import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import type { Thread } from "@pochimail/mailbox/model/thread";

/** Provider-owned text held only for the lifetime of one unit of work (ADR 0014). */
export interface PrivateFields {
  readonly subject?: string;
  readonly snippet?: string;
  readonly from?: string;
  readonly to?: readonly string[];
  readonly suspicious?: IncomingMessage["suspicious"];
  readonly reason?: string;
  readonly reasons?: readonly string[];
  readonly recommendation?: unknown;
  readonly templateHash?: string;
  readonly embeddingRef?: string;
  readonly address?: string;
}

const key = (...parts: readonly string[]) => parts.join("/");

/** The most private fields one long-lived unit of work may keep in memory (ADR 0014). */
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Display fields and free-text reasons are fetched by id and held only for the lifetime of this
 * connection, at most `maxEntries` of them. They never reach a SQL statement, a database file or a
 * log. A unit of work opened after a restart has no cache: rows carry only counts, ids, dates and
 * fixed codes, and the UI asks the provider for anything it needs to display.
 */
export class DisplayFieldsCache {
  private readonly fields = new Map<string, PrivateFields>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  private remember(key: string, fields: PrivateFields): void {
    // Insertion order is recency: a re-remembered id becomes the newest entry.
    this.fields.delete(key);
    this.fields.set(key, fields);
    const oldest = this.fields.keys().next().value;
    if (this.fields.size > this.maxEntries && oldest !== undefined) this.fields.delete(oldest);
  }

  private read(key: string): PrivateFields {
    const fields = this.fields.get(key);
    if (fields === undefined) return {};
    this.fields.delete(key);
    this.fields.set(key, fields);
    return fields;
  }

  rememberMessage(message: IncomingMessage): void {
    this.remember(key(message.workspaceId, message.id), {
      subject: message.subject,
      snippet: message.snippet,
      from: message.from,
      to: message.to,
      ...(message.suspicious === undefined ? {} : { suspicious: message.suspicious }),
    });
  }

  rememberThread(thread: Thread): void {
    this.remember(key("thread", thread.workspaceId, thread.id), { subject: thread.subject });
  }

  rememberSender(ws: string, account: string, hash: string, address: string): void {
    this.remember(key("sender", ws, account, hash), { address });
  }

  rememberFields(scope: string, ws: string, id: string, fields: PrivateFields): void {
    this.remember(key(scope, ws, id), fields);
  }

  of(ws: string, id: string): PrivateFields {
    return this.read(key(ws, id));
  }

  ofThread(ws: string, id: string): PrivateFields {
    return this.read(key("thread", ws, id));
  }

  ofSender(ws: string, account: string, hash: string): PrivateFields {
    return this.read(key("sender", ws, account, hash));
  }

  ofFields(scope: string, ws: string, id: string): PrivateFields {
    return this.read(key(scope, ws, id));
  }

  forgetMessage(ws: string, id: string): void {
    this.fields.delete(key(ws, id));
  }
}
