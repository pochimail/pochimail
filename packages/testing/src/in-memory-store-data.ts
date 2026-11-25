import type { Account } from "@pochimail/accounts/model/account";
import type { ActionLog } from "@pochimail/actions/model/action";
import type { DerivedMessage } from "@pochimail/classification/model/derived";
import type { StoredSignal } from "@pochimail/classification/model/signal";
import type { Topic } from "@pochimail/classification/model/topic";
import type { Suggestion } from "@pochimail/cleanup/model/suggestion";
import type { Page, PageRequest } from "@pochimail/kernel/common";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { Message } from "@pochimail/mailbox/model/message";
import type { SenderStats } from "@pochimail/mailbox/model/sender-stats";
import type { Thread } from "@pochimail/mailbox/model/thread";
import type { SyncCursor } from "@pochimail/mailbox/ports/mail-reader";
import type { OutboxEntry } from "@pochimail/pipeline/outbox";

export interface Data {
  accounts: Map<string, Account>;
  messages: Map<string, Message>;
  threads: Map<string, Thread>;
  derived: Map<string, DerivedMessage>;
  senders: Map<string, SenderStats>;
  suggestions: Map<string, Suggestion>;
  actionLog: Map<string, ActionLog>;
  /** The account of each log entry's first message at append time, like action_log.account_id. */
  actionLogAccount: Map<string, string>;
  topics: Map<string, Topic>;
  cursors: Map<string, SyncCursor>;
  signals: Map<string, StoredSignal>;
  digestState: Map<string, string>;
  /** Ingest sequence per message key, plus the counter and each digest's covered sequence. */
  messageSequence: Map<string, number>;
  counters: Map<string, number>;
  digestSequence: Map<string, number>;
  outbox: OutboxEntry[];
}

export const emptyData = (): Data => ({
  accounts: new Map(),
  messages: new Map(),
  threads: new Map(),
  derived: new Map(),
  senders: new Map(),
  suggestions: new Map(),
  actionLog: new Map(),
  actionLogAccount: new Map(),
  topics: new Map(),
  cursors: new Map(),
  signals: new Map(),
  digestState: new Map(),
  messageSequence: new Map(),
  counters: new Map(),
  digestSequence: new Map(),
  outbox: [],
});

export const key = (...parts: string[]) => parts.join("\u0000");
export const copy = <T>(value: T): T => structuredClone(value);
export const byText = (a: string, b: string) => Number(a > b) - Number(a < b);

export function paginate<T>(sorted: readonly T[], page: PageRequest): Page<T> {
  const start = page.cursor === undefined ? 0 : Number(page.cursor);
  const items = sorted.slice(start, start + page.limit).map(copy);
  const end = start + items.length;
  return { items, nextCursor: end < sorted.length ? String(end) : null };
}

/** Drops the account and everything that belongs to it; the action log is the audit trail. */
export function removeAccount(data: Data, ws: WorkspaceId, id: string): void {
  const doomed = new Set<string>();
  for (const [k, m] of data.messages)
    if (m.workspaceId === ws && m.accountId === id) {
      doomed.add(m.id);
      data.messages.delete(k);
      data.messageSequence.delete(k);
    }
  const owned = <T extends { workspaceId: string; accountId: string }>(map: Map<string, T>) => {
    for (const [k, v] of map) if (v.workspaceId === ws && v.accountId === id) map.delete(k);
  };
  owned(data.threads);
  owned(data.derived);
  owned(data.senders);
  owned(data.suggestions);
  for (const [k, s] of data.signals)
    if (s.workspaceId === ws && doomed.has(s.messageId)) data.signals.delete(k);
  // Pending events and jobs of the account go; log entries about its mail are anonymised.
  data.outbox = data.outbox.filter((e) => {
    const payload = e.kind === "event" ? (e.event as { payload?: unknown }).payload : e.job.payload;
    const owner = (payload as { accountId?: unknown } | null)?.accountId;
    return owner !== id;
  });
  for (const [k, log] of data.actionLog) {
    if (log.workspaceId !== ws || !doomed.has(log.command.messageIds[0] ?? "")) continue;
    const redact = <C extends { kind: string; messageIds: readonly string[] }>(c: C) => ({
      kind: c.kind,
      messageIds: c.messageIds.map((_, i) => `removed-${i + 1}`),
    });
    data.actionLog.set(k, {
      ...log,
      command: redact(log.command) as never,
      inverse: log.inverse === null ? null : (redact(log.command) as never),
    });
  }
  data.accounts.delete(key(ws, id));
  for (const k of [...data.cursors.keys()])
    if (k.startsWith(key(ws, id, ""))) data.cursors.delete(k);
  data.digestState.delete(key(ws, id));
  data.digestSequence.delete(key(ws, id));
}
