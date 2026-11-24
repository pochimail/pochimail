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

/**
 * Display fields and free-text reasons are fetched by id and held only for the lifetime of this
 * connection. They never reach a SQL statement, a database file or a log. A unit of work opened
 * after a restart has no cache: rows carry only counts, ids, dates and fixed codes, and the UI
 * asks the provider for anything it needs to display.
 */
export class DisplayFieldsCache {
  private readonly fields = new Map<string, PrivateFields>();

  rememberMessage(message: IncomingMessage): void {
    this.fields.set(key(message.workspaceId, message.id), {
      subject: message.subject,
      snippet: message.snippet,
      from: message.from,
      to: message.to,
      ...(message.suspicious === undefined ? {} : { suspicious: message.suspicious }),
    });
  }

  rememberThread(thread: Thread): void {
    this.fields.set(key("thread", thread.workspaceId, thread.id), { subject: thread.subject });
  }

  rememberSender(ws: string, account: string, hash: string, address: string): void {
    this.fields.set(key("sender", ws, account, hash), { address });
  }

  rememberFields(scope: string, ws: string, id: string, fields: PrivateFields): void {
    this.fields.set(key(scope, ws, id), fields);
  }

  of(ws: string, id: string): PrivateFields {
    return this.fields.get(key(ws, id)) ?? {};
  }

  ofThread(ws: string, id: string): PrivateFields {
    return this.fields.get(key("thread", ws, id)) ?? {};
  }

  ofSender(ws: string, account: string, hash: string): PrivateFields {
    return this.fields.get(key("sender", ws, account, hash)) ?? {};
  }

  ofFields(scope: string, ws: string, id: string): PrivateFields {
    return this.fields.get(key(scope, ws, id)) ?? {};
  }

  forgetMessage(ws: string, id: string): void {
    this.fields.delete(key(ws, id));
  }
}
