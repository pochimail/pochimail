import { type Command, inverseOf } from "@pochimail/actions/model/action";
import type {
  AppliedCommand,
  MailProviderCapabilities,
  MailProviderError,
} from "@pochimail/actions/ports/mail-commands";
import {
  Cancelled,
  Conflict,
  Offline,
  type ProviderError,
  RateLimited,
} from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import { createFaults, type Faults } from "@pochimail/kernel/testing/faults";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import type { SyncCursor } from "@pochimail/mailbox/ports/mail-reader";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import { readMailbox } from "./mailbox-reader.ts";

/** What archive/label commands did to one message, kept in memory only. */
export interface FixtureMessageState {
  readonly archived: boolean;
  readonly labels: readonly string[];
  readonly handled: boolean;
  readonly unsubscribed: boolean;
}

export interface FixtureMailProvider extends MailProvider {
  readonly faults: Faults<ProviderError>;
  /** Mail arriving after the mbox was loaded; the next delta sync returns it. */
  deliver(...messages: IncomingMessage[]): void;
  stateOf(messageId: string): FixtureMessageState | undefined;
  /** Makes every cursor handed out so far stale, as a provider that dropped its history would. */
  expireCursors(): void;
  simulateOffline(): void;
  simulateRateLimit(retryAfterMs?: number): void;
}

export interface FixtureMailProviderOptions {
  /** An mbox produced by `generateMailbox` (or any fixture in the same shape). */
  readonly mbox?: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly pageSize?: number;
  readonly capabilities?: Partial<MailProviderCapabilities>;
}

const CAPABILITIES: MailProviderCapabilities = {
  organization: "labels",
  archive: "remove-inbox-label",
  batchModify: { maxCommands: 50 },
  deltaSync: true,
  pushWakeups: false,
  unsubscribeSend: true,
};

interface Entry {
  message: IncomingMessage;
  body: string;
  state: { archived: boolean; labels: Set<string>; handled: boolean; unsubscribed: boolean };
  /** Change number of the last delivery or command touching this message. */
  rev: number;
}

const SCOPE = "fixture";

/**
 * Cursor tokens: `b:<epoch>:<snapshot>:<offset>` while a backfill is paging, `d:<epoch>:<rev>`
 * once caught up. A token from another epoch, or from the future, restarts with a full walk.
 */
export function createFixtureMailProvider(
  options: FixtureMailProviderOptions,
): FixtureMailProvider {
  const pageSize = options.pageSize ?? 500;
  const faults = createFaults<ProviderError>();
  const records = new Map<string, Entry>();
  let order: Entry[] = [];
  let rev = 0;
  let epoch = 0;

  const add = (message: IncomingMessage, body: string) => {
    const existing = records.get(message.id);
    if (existing) {
      existing.message = structuredClone(message);
      existing.rev = ++rev;
      return;
    }
    const record: Entry = {
      message: structuredClone(message),
      body,
      state: { archived: false, labels: new Set(), handled: false, unsubscribed: false },
      rev: ++rev,
    };
    records.set(message.id, record);
    order.push(record);
  };

  if (options.mbox !== undefined)
    for (const { message, body } of readMailbox(options.mbox, options)) add(message, body);
  // Oldest first, like a real backfill walk; ties keep file order.
  order = [...order].sort((a, b) => a.message.receivedAt.localeCompare(b.message.receivedAt));

  const gate = (signal: { aborted: boolean }) => (signal.aborted ? new Cancelled() : faults.take());
  const cursor = (token: string): SyncCursor => ({ scope: SCOPE, token });

  const parse = (c: SyncCursor | null) => {
    if (!c || c.scope !== SCOPE) return null;
    const [kind, e, a, b] = c.token.split(":");
    if ((kind !== "b" && kind !== "d") || Number(e) !== epoch) return null;
    const first = Number(a);
    if (!Number.isInteger(first) || first < 0 || first > rev) return null;
    return { kind, first, offset: Number(b ?? 0) };
  };

  return {
    capabilities: { ...CAPABILITIES, ...options.capabilities },
    faults,
    deliver: (...messages) => {
      for (const message of messages) add(message, message.snippet);
      order = [...order].sort((a, b) => a.message.receivedAt.localeCompare(b.message.receivedAt));
    },
    stateOf: (id) => {
      const record = records.get(id);
      return record && { ...record.state, labels: [...record.state.labels].sort() };
    },
    expireCursors: () => void epoch++,
    simulateOffline: () => faults.failWith(new Offline()),
    simulateRateLimit: (retryAfterMs) =>
      faults.failWith(new RateLimited(retryAfterMs === undefined ? {} : { retryAfterMs })),

    async sync(from, signal) {
      const failure = gate(signal);
      if (failure) return err(failure as MailProviderError);
      let position = parse(from);
      const restarted = from !== null && position === null;
      if (position === null) position = { kind: "b", first: rev, offset: 0 };

      if (position.kind === "b") {
        const page = order.slice(position.offset, position.offset + pageSize);
        const end = position.offset + page.length;
        const hasMore = end < order.length;
        return ok({
          messages: structuredClone(page.map((r) => r.message)),
          nextCursor: cursor(
            hasMore ? `b:${epoch}:${position.first}:${end}` : `d:${epoch}:${position.first}`,
          ),
          hasMore,
          restarted,
        });
      }
      const changed = [...records.values()]
        .filter((r) => r.rev > position.first)
        .sort((a, b) => a.rev - b.rev);
      const page = changed.slice(0, pageSize);
      const hasMore = changed.length > page.length;
      const through = hasMore ? (page[page.length - 1]?.rev ?? position.first) : rev;
      return ok({
        messages: structuredClone(page.map((r) => r.message)),
        nextCursor: cursor(`d:${epoch}:${through}`),
        hasMore,
        restarted: false,
      });
    },

    async applyCommands(commands, signal) {
      const failure = gate(signal);
      if (failure) return err(failure as MailProviderError);
      const applied: AppliedCommand[] = commands.map((command) => {
        for (const id of command.messageIds) {
          const record = records.get(id);
          if (!record) continue; // gone since the suggestion was made: nothing to change
          if (applyEffect(record.state, command)) record.rev = ++rev;
        }
        return { command, inverse: inverseOf(command) };
      });
      return ok(applied);
    },

    async fetchBody(messageId, signal) {
      const failure = gate(signal);
      if (failure) return err(failure as MailProviderError);
      const record = records.get(messageId);
      return record ? ok(record.body) : err(new Conflict("Message no longer exists"));
    },
  };
}

/** Returns whether the command changed anything. Delete moves mail to Trash (ADR 0012); the fixture mailbox keeps no Trash. */
function applyEffect(state: Entry["state"], command: Command): boolean {
  const flag = (key: "archived" | "handled", value: boolean) => {
    const changed = state[key] !== value;
    state[key] = value;
    return changed;
  };
  switch (command.kind) {
    case "archive":
      return flag("archived", true);
    case "unarchive":
      return flag("archived", false);
    case "trash":
    case "untrash":
      return false; // the fixture mailbox keeps no Trash
    case "mark-handled":
      return flag("handled", true);
    case "unmark-handled":
      return flag("handled", false);
    case "apply-label": {
      if (!command.label || state.labels.has(command.label)) return false;
      state.labels.add(command.label);
      return true;
    }
    case "remove-label":
      return command.label ? state.labels.delete(command.label) : false;
    case "unsubscribe": {
      const changed = !state.unsubscribed;
      state.unsubscribed = true;
      return changed;
    }
  }
}
