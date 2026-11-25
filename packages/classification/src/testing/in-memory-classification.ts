import { Cancelled, NotFound } from "@pochimail/kernel/errors";
import type { EventEnvelope } from "@pochimail/kernel/event";
import { err, ok } from "@pochimail/kernel/result";
import type { SuspiciousFlag } from "../model/category.ts";
import { CATEGORIES } from "../model/category.ts";
import type { DerivedMessage } from "../model/derived.ts";
import type { ClassifiableMessage, SignalFacts } from "../model/message-facts.ts";
import type { StoredSignal } from "../model/signal.ts";
import type { Topic } from "../model/topic.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";
import { makeDerived, makeMessage, OWNER_ADDRESS, type Seeder, WS_A } from "./samples.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const byText = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/** A message as the in-memory mailbox keeps it, with the facts only signals read. */
type StoredMessage = ClassifiableMessage & {
  category: string;
  attachmentCount?: number;
  suspicious?: SuspiciousFlag;
};

/** The facts the signal rules read of one stored message and its sender's statistics. */
function factsOf(
  m: StoredMessage,
  sender: { vip: boolean; repliedCount: number } | undefined,
): SignalFacts {
  return {
    messageId: m.id,
    fromOwner: m.from === "" ? undefined : m.from.toLowerCase() === OWNER_ADDRESS,
    ...(m.suspicious === undefined ? {} : { suspicious: m.suspicious }),
    storedCategory: m.category,
    receivedAt: m.receivedAt,
    opened: m.opened,
    lastInThread: true,
    senderVip: sender?.vip ?? false,
    senderRepliedCount: sender?.repliedCount ?? 0,
    hasListUnsubscribe: m.hasListUnsubscribe,
    ...(m.attachmentCount === undefined ? {} : { attachmentCount: m.attachmentCount }),
  };
}

interface Data {
  messages: Map<string, StoredMessage>;
  derived: Map<string, DerivedMessage>;
  signals: Map<string, StoredSignal>;
  topics: Map<string, Topic>;
  senders: Map<string, { vip: boolean; repliedCount: number }>;
}
const empty = (): Data => ({
  messages: new Map(),
  derived: new Map(),
  signals: new Map(),
  topics: new Map(),
  senders: new Map(),
});
const clone = (d: Data): Data => ({
  messages: new Map(d.messages),
  derived: new Map(d.derived),
  signals: new Map(d.signals),
  topics: new Map(d.topics),
  senders: new Map(d.senders),
});

export interface InMemoryClassification extends Seeder {
  readonly uow: ClassificationUnitOfWork;
  /** Events committed so far, in order; a rolled-back transaction leaves none. */
  committedEvents(): readonly EventEnvelope[];
  /** Derived rows, signals and events committed so far, as plain data (for leak checks). */
  snapshot(): Promise<{
    derived: unknown[];
    signals: unknown[];
    outbox: { event: EventEnvelope }[];
  }>;
}

/** The domain's rows and events in memory, with commit-or-roll-back like the real unit of work. */
export function createInMemoryClassification(): InMemoryClassification {
  let committed = empty();
  let events: EventEnvelope[] = [];

  const reads = (data: () => Data): ClassificationUnitOfWork["reads"] => ({
    derived: {
      get: async (ws, id) => {
        const d = data().derived.get(`${ws}/${id}`);
        return d ? ok(copy(d)) : err(new NotFound("Derived data"));
      },
      listForMessages: async (ws, ids) => {
        const wanted = new Set<string>(ids);
        return ok(
          [...data().derived.values()]
            .filter((d) => d.workspaceId === ws && wanted.has(d.messageId))
            .map(copy),
        );
      },
      list: async (ws, accountId, page) => {
        const rows = [...data().derived.values()]
          .filter((d) => d.workspaceId === ws && d.accountId === accountId)
          .sort((a, b) => byText(a.messageId, b.messageId));
        const start = page.cursor === undefined ? 0 : Number(page.cursor);
        const items = rows.slice(start, start + page.limit).map(copy);
        const end = start + items.length;
        return ok({ items, nextCursor: end < rows.length ? String(end) : null });
      },
    },
    signals: {
      listForMessages: async (ws, ids) => {
        const wanted = new Set<string>(ids);
        return ok(
          [...data().signals.values()]
            .filter((s) => s.workspaceId === ws && wanted.has(s.messageId))
            .sort((a, b) => byText(a.messageId, b.messageId) || byText(a.kind, b.kind))
            .map(copy),
        );
      },
    },
    topics: {
      get: async (ws, id) => {
        const t = data().topics.get(`${ws}/${id}`);
        return t ? ok(copy(t)) : err(new NotFound("Topic"));
      },
      list: async (ws) =>
        ok([...data().topics.values()].filter((t) => t.workspaceId === ws).map(copy)),
    },
    messages: {
      get: async (ws, id) => {
        const m = data().messages.get(`${ws}/${id}`);
        if (!m) return err(new NotFound("Message"));
        const { category: _category, attachmentCount: _count, suspicious: _flag, ...message } = m;
        return ok(copy(message));
      },
      countByCategory: async (ws, accountIds) => {
        const counts: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
        for (const [key, m] of data().messages)
          if (key.startsWith(`${ws}/`) && accountIds.includes(m.accountId))
            counts[m.category] = (counts[m.category] ?? 0) + 1;
        return ok(counts);
      },
    },
    signalFacts: {
      forMessages: async (ws, accountId, ids) => {
        const out = [];
        for (const id of [...ids].sort()) {
          const m = data().messages.get(`${ws}/${id}`);
          if (!m) return err(new NotFound("Message"));
          if (m.accountId === accountId) out.push(factsOf(m, data().senders.get(m.from)));
        }
        return ok(out);
      },
    },
  });

  const uow: ClassificationUnitOfWork = {
    reads: reads(() => committed),
    run: async (work, signal) => {
      if (signal?.aborted) return err(new Cancelled());
      const draft = clone(committed);
      const pending: EventEnvelope[] = [];
      const r = reads(() => draft);
      const result = await work({
        repositories: {
          derived: {
            ...r.derived,
            save: async (d) => {
              draft.derived.set(`${d.workspaceId}/${d.messageId}`, copy(d));
              return ok(undefined);
            },
          },
          signals: {
            ...r.signals,
            replaceForMessages: async (ws, ids, signals) => {
              const scope = new Set<string>(ids);
              for (const [k, s] of draft.signals)
                if (s.workspaceId === ws && scope.has(s.messageId)) draft.signals.delete(k);
              for (const s of signals)
                draft.signals.set(`${s.workspaceId}/${s.messageId}/${s.kind}`, copy(s));
              return ok(undefined);
            },
          },
          topics: {
            ...r.topics,
            save: async (t) => {
              draft.topics.set(`${t.workspaceId}/${t.id}`, copy(t));
              return ok(undefined);
            },
          },
          messages: {
            setCategory: async (ws, id, category) => {
              const m = draft.messages.get(`${ws}/${id}`);
              if (!m) return err(new NotFound("Message"));
              draft.messages.set(`${ws}/${id}`, { ...m, category });
              return ok(undefined);
            },
          },
        },
        events: {
          append: async (batch) => {
            pending.push(...copy(batch));
            return ok(undefined);
          },
        },
      });
      if (signal?.aborted) return err(new Cancelled());
      if (result.ok) {
        committed = draft;
        events = [...events, ...pending];
      }
      return result;
    },
  };

  return {
    uow,
    committedEvents: () => events.map(copy),
    snapshot: async () => ({
      derived: copy([...committed.derived.values()]),
      signals: copy([...committed.signals.values()]),
      outbox: events.map((event) => ({ event: copy(event) })),
    }),
    seed: async (rows) => {
      for (const [key, row] of Object.entries(rows)) {
        const n = Number(key);
        const message = makeMessage(n, row.message);
        const category = row.category ?? "notifications";
        committed.messages.set(`${WS_A}/${message.id}`, {
          ...message,
          category,
          ...(row.attachmentCount === undefined ? {} : { attachmentCount: row.attachmentCount }),
          ...(row.suspicious === undefined ? {} : { suspicious: row.suspicious }),
        });
        if (row.derived !== null)
          committed.derived.set(
            `${WS_A}/${message.id}`,
            makeDerived(n, { category, snippet: message.snippet, ...row.derived }),
          );
      }
    },
    setSender: async (address, stats) => {
      committed.senders.set(address, {
        vip: stats.vip ?? false,
        repliedCount: stats.repliedCount ?? 0,
      });
    },
  };
}
