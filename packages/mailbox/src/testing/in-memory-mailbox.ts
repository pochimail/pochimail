import { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { EventEnvelope } from "@pochimail/kernel/event";
import { err, ok } from "@pochimail/kernel/result";
import { fakeSenderHash } from "@pochimail/kernel/testing/fake-sender-hash";
import type { IncomingMessage, Message } from "../model/message.ts";
import type { SenderStats } from "../model/sender-stats.ts";
import type { Thread } from "../model/thread.ts";
import type { SyncCursor } from "../ports/mail-reader.ts";
import type { MailboxUnitOfWork } from "../ports/unit-of-work.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const byText = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};
const DEFAULT_LABEL = "notifications";

interface Data {
  messages: Map<string, Message & { seq: number }>;
  threads: Map<string, Thread>;
  senders: Map<string, SenderStats>;
  cursors: Map<string, SyncCursor>;
  counter: number;
}
const empty = (): Data => ({
  messages: new Map(),
  threads: new Map(),
  senders: new Map(),
  cursors: new Map(),
  counter: 0,
});
const clone = (d: Data): Data => ({
  messages: new Map(d.messages),
  threads: new Map(d.threads),
  senders: new Map(d.senders),
  cursors: new Map(d.cursors),
  counter: d.counter,
});
const strip = ({ seq: _seq, ...message }: Message & { seq: number }): Message => copy(message);

export interface InMemoryMailbox {
  readonly uow: MailboxUnitOfWork;
  /** Events committed so far, in order; a rolled-back transaction leaves none. */
  committedEvents(): readonly EventEnvelope[];
}

/** The mailbox's rows and events in memory, with commit-or-roll-back like the real unit of work. */
export function createInMemoryMailbox(): InMemoryMailbox {
  let committed = empty();
  let events: EventEnvelope[] = [];

  const reads = (data: () => Data) => ({
    messages: {
      get: async (ws: string, id: string) => {
        const m = data().messages.get(`${ws}/${id}`);
        return m ? ok(strip(m)) : err(new NotFound("Message"));
      },
      query: async (ws: string, q: import("../ports/message-repository.ts").MessageQuery) => {
        const rows = [...data().messages.values()]
          .filter(
            (m) =>
              m.workspaceId === ws &&
              m.accountId === q.accountId &&
              (q.category === undefined || m.category === q.category) &&
              (q.senderAddress === undefined || m.from === q.senderAddress) &&
              (q.afterSequence === undefined || m.seq > q.afterSequence) &&
              (q.throughSequence === undefined || m.seq <= q.throughSequence),
          )
          .sort((a, b) => byText(b.receivedAt, a.receivedAt) || byText(a.id, b.id));
        const start = q.cursor === undefined ? 0 : Number(q.cursor);
        const items = rows.slice(start, start + q.limit).map(strip);
        const end = start + items.length;
        return ok({ items, nextCursor: end < rows.length ? String(end) : null });
      },
      latestSequence: async (ws: string, accountId: string) =>
        ok(
          Math.max(
            0,
            ...[...data().messages.values()]
              .filter((m) => m.workspaceId === ws && m.accountId === accountId)
              .map((m) => m.seq),
          ),
        ),
      countByCategory: async (ws: string, accountIds: readonly string[]) => {
        const counts: Record<string, number> = {};
        for (const m of data().messages.values())
          if (m.workspaceId === ws && accountIds.includes(m.accountId))
            counts[m.category] = (counts[m.category] ?? 0) + 1;
        return ok(counts);
      },
    },
    threads: {
      get: async (ws: string, id: string) => {
        const t = data().threads.get(`${ws}/${id}`);
        return t ? ok(copy(t)) : err(new NotFound("Thread"));
      },
    },
    senders: {
      get: async (ws: string, accountId: string, address: string) => {
        const s = data().senders.get(`${ws}/${accountId}/${address}`);
        return s ? ok(copy(s)) : err(new NotFound("Sender"));
      },
      ofMessage: async (ws: string, id: string, ownerAddress: string) => {
        const m = data().messages.get(`${ws}/${id}`);
        if (!m) return err(new NotFound("Message"));
        const stats = data().senders.get(`${ws}/${m.accountId}/${m.from}`);
        return ok({
          fromOwner: m.from.toLowerCase() === ownerAddress.toLowerCase(),
          stats: stats ? copy(stats) : undefined,
        });
      },
      list: async (ws: string, accountId: string, p: { limit: number; cursor?: string }) => {
        const rows = [...data().senders.values()]
          .filter((s) => s.workspaceId === ws && s.accountId === accountId)
          .sort((a, b) => (a.address < b.address ? -1 : 1));
        const start = p.cursor === undefined ? 0 : Number(p.cursor);
        const items = rows.slice(start, start + p.limit).map(copy);
        const end = start + items.length;
        return ok({ items, nextCursor: end < rows.length ? String(end) : null });
      },
    },
    cursors: {
      get: async (ws: string, accountId: string, scope: string) => {
        const c = data().cursors.get(`${ws}/${accountId}/${scope}`);
        return ok(c ? copy(c) : null);
      },
    },
  });

  const uow: MailboxUnitOfWork = {
    reads: reads(() => committed) as unknown as MailboxUnitOfWork["reads"],
    async run(work, signal) {
      const draft = clone(committed);
      const drafted: EventEnvelope[] = [];
      let outcome: Awaited<ReturnType<typeof work>>;
      try {
        outcome = await work({
          repositories: {
            ...(reads(() => draft) as unknown as MailboxUnitOfWork["reads"]),
            messages: {
              ...(reads(() => draft).messages as unknown as MailboxUnitOfWork["reads"]["messages"]),
              upsertMany: async (batch: readonly IncomingMessage[]) => {
                for (const m of batch) {
                  const key = `${m.workspaceId}/${m.id}`;
                  const before = draft.messages.get(key);
                  draft.messages.set(key, {
                    ...copy(m),
                    category: before?.category ?? DEFAULT_LABEL,
                    senderHash: fakeSenderHash(m.accountId, m.from),
                    seq: before?.seq ?? ++draft.counter,
                  });
                }
                return ok(undefined);
              },
              setCategory: async (ws: string, id: string, category: string) => {
                const before = draft.messages.get(`${ws}/${id}`);
                if (!before) return err(new NotFound("Message"));
                draft.messages.set(`${ws}/${id}`, { ...before, category });
                return ok(undefined);
              },
            },
            threads: {
              ...(reads(() => draft).threads as unknown as MailboxUnitOfWork["reads"]["threads"]),
              upsert: async (t: Thread) => {
                draft.threads.set(`${t.workspaceId}/${t.id}`, copy(t));
                return ok(undefined);
              },
            },
            senders: {
              ...(reads(() => draft).senders as unknown as MailboxUnitOfWork["reads"]["senders"]),
              upsert: async (s: SenderStats) => {
                draft.senders.set(`${s.workspaceId}/${s.accountId}/${s.address}`, copy(s));
                return ok(undefined);
              },
            },
            cursors: {
              ...(reads(() => draft).cursors as unknown as MailboxUnitOfWork["reads"]["cursors"]),
              set: async (ws: string, accountId: string, cursor: SyncCursor) => {
                draft.cursors.set(`${ws}/${accountId}/${cursor.scope}`, copy(cursor));
                return ok(undefined);
              },
            },
          },
          events: {
            append: async (e) => {
              drafted.push(...copy(e));
              return ok(undefined);
            },
          },
        });
      } catch (cause) {
        return err(new StorageError("Transaction failed", { cause }));
      }
      if (!outcome.ok || signal?.aborted) return outcome;
      committed = draft;
      events = [...events, ...drafted];
      return outcome;
    },
  };
  return { uow, committedEvents: () => events };
}
