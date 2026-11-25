import { unresolvedPending } from "@pochimail/actions/model/action";
import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { Cancelled, NotFound, StorageError } from "@pochimail/kernel/errors";
import type { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { createFaults, type Faults } from "@pochimail/kernel/testing/faults";
import type { Message } from "@pochimail/mailbox/model/message";
import type { OutboxEntry, OutboxRecord, OutboxStore } from "@pochimail/pipeline/outbox";
import { eventSinkOver } from "@pochimail/pipeline/outbox-event-sink";
import { copy, type Data, emptyData, key, removeAccount } from "./in-memory-store-data.ts";
import { applyActionEffects, storeMessage } from "./read-models/action-effects.ts";
import { byText, inSequenceRange, oldestFirst, paginate } from "./read-models/in-memory-paging.ts";
import { inMemoryReads, senderOfMessage } from "./read-models/in-memory-reads.ts";
import type { ReadRepositories, Transaction, UnitOfWork, WriteRepositories } from "./uow-types.ts";

export interface InMemoryUnitOfWork {
  readonly uow: UnitOfWork;
  /** Everything committed to the outbox so far, in order. */
  committedOutbox(): Promise<readonly OutboxEntry[]>;
  /** The relay's view of the committed outbox: undelivered rows, and marking them delivered. */
  readonly outboxStore: OutboxStore;
  /** Everything committed, every repository and the outbox, as plain data (for leak checks). */
  snapshot(): Promise<unknown>;
  /** Force repository and outbox calls to fail with a `StorageError`. */
  readonly faults: Faults<StorageError>;
}

/**
 * In-memory repositories plus a transactional UnitOfWork. A transaction works on a private copy;
 * commit swaps it in, rollback drops it. Transactions run one at a time.
 */
export function createInMemoryUnitOfWork(): InMemoryUnitOfWork {
  let committed = emptyData();
  const faults = createFaults<StorageError>();
  const fail = () => faults.take();

  /** Builds the repositories over whichever dataset `data()` currently names. */
  function readers(data: () => Data): ReadRepositories {
    const guarded = <T>(read: () => Result<T, StorageError | NotFound>) => {
      const failure = fail();
      return Promise.resolve(failure ? err(failure) : read());
    };
    const found = <T>(map: Map<string, T>, k: string, what: string) =>
      guarded(() => {
        const v = map.get(k);
        return v === undefined ? err(new NotFound(what)) : ok(copy(v));
      });
    const base: Omit<ReadRepositories, "signalFacts" | "mailboxFacts"> = {
      accounts: {
        get: (ws, id) => found(data().accounts, key(ws, id), "Account"),
        list: (ws) =>
          guarded(() =>
            ok([...data().accounts.values()].filter((a) => a.workspaceId === ws).map(copy)),
          ) as never,
      },
      messages: {
        get: (ws, id) => found(data().messages, key(ws, id), "Message"),
        query: (ws, q) =>
          guarded(() => {
            const rows = [...data().messages.values()]
              .filter(
                (m) =>
                  m.workspaceId === ws &&
                  m.accountId === q.accountId &&
                  (q.category === undefined || m.category === q.category) &&
                  (q.senderAddress === undefined || m.from === q.senderAddress) &&
                  inSequenceRange(data(), m, q),
              )
              .sort((a, b) => byText(b.receivedAt, a.receivedAt) || byText(a.id, b.id));
            return ok(paginate(rows, q));
          }) as never,
        countByCategory: (ws, accountIds) =>
          guarded(() => {
            const counts: Record<string, number> = Object.fromEntries(
              EMAIL_TYPES.map((c) => [c, 0]),
            );
            for (const m of data().messages.values())
              if (m.workspaceId === ws && accountIds.includes(m.accountId))
                counts[m.category] = (counts[m.category] ?? 0) + 1;
            return ok(counts);
          }) as never,
        latestSequence: (ws, acc) =>
          guarded(() => {
            const d = data();
            let newest = 0;
            for (const m of d.messages.values())
              if (m.workspaceId === ws && m.accountId === acc)
                newest = Math.max(newest, d.messageSequence.get(key(ws, m.id)) ?? 0);
            return ok(newest);
          }) as never,
      },
      threads: { get: (ws, id) => found(data().threads, key(ws, id), "Thread") },
      derived: {
        get: (ws, id) => found(data().derived, key(ws, id), "Derived data"),
        list: (ws, acc, page) =>
          guarded(() => {
            const rows = [...data().derived.values()]
              .filter((d) => d.workspaceId === ws && d.accountId === acc)
              .sort((a, b) => byText(a.messageId, b.messageId));
            return ok(paginate(rows, page));
          }) as never,
      },
      senders: {
        get: (ws, acc, address) => found(data().senders, key(ws, acc, address), "Sender"),
        ofMessage: (ws, id, o) => guarded(() => senderOfMessage(data(), ws, id, o)),
        list: (ws, acc, page) =>
          guarded(() => {
            const rows = [...data().senders.values()]
              .filter((s) => s.workspaceId === ws && s.accountId === acc)
              .sort((a, b) => byText(a.address, b.address));
            return ok(paginate(rows, page));
          }) as never,
      },
      suggestions: {
        get: (ws, id) => found(data().suggestions, key(ws, id), "Suggestion"),
        listPending: (ws, page) =>
          guarded(() => {
            const rows = [...data().suggestions.values()]
              .filter((s) => s.workspaceId === ws && s.state === "pending")
              .sort((a, b) => byText(a.createdAt, b.createdAt) || byText(a.id, b.id));
            return ok(paginate(rows, page));
          }) as never,
      },
      actionLog: {
        get: (ws, id) => found(data().actionLog, key(ws, id), "Action log entry"),
        listForAction: (ws, actionId) =>
          guarded(() =>
            ok(oldestFirst(data().actionLog, ws, (l) => l.actionId === actionId)),
          ) as never,
        listForKey: (ws, idempotencyKey) =>
          guarded(() =>
            ok(oldestFirst(data().actionLog, ws, (l) => l.idempotencyKey === idempotencyKey)),
          ) as never,
        listForBatch: (ws, batchId) =>
          guarded(() =>
            ok(oldestFirst(data().actionLog, ws, (l) => l.batchId === batchId)),
          ) as never,
        listPending: (ws, before) =>
          guarded(() => ok(unresolvedPending(oldestFirst(data().actionLog, ws), before))) as never,
        list: (ws, page) =>
          guarded(() => {
            const rows = [...data().actionLog.values()].filter((l) => l.workspaceId === ws);
            return ok(paginate(rows, page));
          }) as never,
      },
      topics: {
        get: (ws, id) => found(data().topics, key(ws, id), "Topic"),
        list: (ws) =>
          guarded(() =>
            ok([...data().topics.values()].filter((t) => t.workspaceId === ws).map(copy)),
          ) as never,
      },
      cursors: {
        get: (ws, acc, scope) =>
          guarded(() => {
            const c = data().cursors.get(key(ws, acc, scope));
            return ok(c === undefined ? null : copy(c));
          }) as never,
      },
      signals: {
        listForMessages: (ws, ids) =>
          guarded(() => {
            const wanted = new Set<string>(ids);
            const rows = [...data().signals.values()]
              .filter((s) => s.workspaceId === ws && wanted.has(s.messageId))
              .sort((a, b) => byText(a.messageId, b.messageId) || byText(a.kind, b.kind));
            return ok(rows.map(copy));
          }) as never,
      },
      digestState: {
        get: (ws, acc) => guarded(() => ok(data().digestState.get(key(ws, acc)) ?? null)) as never,
        getSequence: (ws, acc) =>
          guarded(() => ok(data().digestSequence.get(key(ws, acc)) ?? 0)) as never,
      },
    };
    return inMemoryReads(base, data, fail);
  }

  function writers(data: () => Data): WriteRepositories {
    const r = readers(data);
    const put = <T>(map: () => Map<string, T>, k: string, value: T) => {
      const failure = fail();
      if (failure) return Promise.resolve(err(failure));
      map().set(k, copy(value));
      return Promise.resolve(ok(undefined));
    };
    const patchMessage = async (ws: WorkspaceId, id: MessageId, change: Partial<Message>) => {
      const failure = fail();
      if (failure) return err(failure);
      const existing = data().messages.get(key(ws, id));
      if (!existing) return err(new NotFound("Message"));
      data().messages.set(key(ws, id), { ...existing, ...change });
      return ok(undefined);
    };
    return {
      accounts: {
        ...r.accounts,
        save: (a) => put(() => data().accounts, key(a.workspaceId, a.id), a),
        remove: async (ws, id) => {
          const failure = fail();
          if (failure) return err(failure);
          removeAccount(data(), ws, id);
          return ok(undefined);
        },
      },
      messages: {
        ...r.messages,
        upsertMany: async (messages) => {
          const failure = fail();
          if (failure) return err(failure);
          for (const m of messages) {
            const k = key(m.workspaceId, m.id);
            const existing = data().messages.get(k);
            if (!existing) {
              const next = (data().counters.get("ingest") ?? 0) + 1;
              data().counters.set("ingest", next);
              data().messageSequence.set(k, next);
            }
            data().messages.set(k, storeMessage(m, existing));
          }
          return ok(undefined);
        },
        setCategory: (ws, id, category) => patchMessage(ws, id, { category }),
        setTopics: (ws, id, topicIds) => patchMessage(ws, id, { topicIds: [...topicIds] }),
      },
      derived: {
        ...r.derived,
        save: (d) => put(() => data().derived, key(d.workspaceId, d.messageId), d),
      },
      threads: {
        ...r.threads,
        upsert: (t) => put(() => data().threads, key(t.workspaceId, t.id), t),
      },
      senders: {
        ...r.senders,
        upsert: (s) => put(() => data().senders, key(s.workspaceId, s.accountId, s.address), s),
      },
      suggestions: {
        ...r.suggestions,
        save: (s) => put(() => data().suggestions, key(s.workspaceId, s.id), s),
      },
      actionLog: {
        ...r.actionLog,
        append: async (entry) => {
          const failure = fail();
          if (failure) return err(failure);
          const k = key(entry.workspaceId, entry.id);
          // Append-only: an existing entry is never replaced.
          if (data().actionLog.has(k))
            return err(new StorageError("Action log entry already exists"));
          data().actionLog.set(k, copy(entry));
          applyActionEffects(data(), k, entry);
          return ok(undefined);
        },
      },
      topics: { ...r.topics, save: (t) => put(() => data().topics, key(t.workspaceId, t.id), t) },
      cursors: {
        ...r.cursors,
        set: (ws, acc, cursor) => put(() => data().cursors, key(ws, acc, cursor.scope), cursor),
      },
      signals: {
        ...r.signals,
        replaceForMessages: async (ws, ids, signals) => {
          const failure = fail();
          if (failure) return err(failure);
          const scope = new Set<string>(ids);
          for (const [k, s] of data().signals)
            if (s.workspaceId === ws && scope.has(s.messageId)) data().signals.delete(k);
          for (const s of signals)
            data().signals.set(key(s.workspaceId, s.messageId, s.kind), copy(s));
          return ok(undefined);
        },
      },
      digestState: {
        ...r.digestState,
        set: async (ws, acc, at, lastSequence) => {
          const failure = fail();
          if (failure) return err(failure);
          data().digestState.set(key(ws, acc), at);
          if (lastSequence !== undefined) data().digestSequence.set(key(ws, acc), lastSequence);
          return ok(undefined);
        },
      },
    };
  }

  // Committed outbox is append-only, so the index is a stable row id.
  const delivered = new Set<number>();
  const outboxStore: OutboxStore = {
    async pending(limit) {
      const rows: OutboxRecord[] = [];
      committed.outbox.forEach((entry, i) => {
        if (!delivered.has(i) && rows.length < limit)
          rows.push({ id: String(i), entry: copy(entry) });
      });
      return ok(rows);
    },
    async markDelivered(id) {
      const i = Number(id);
      if (!Number.isInteger(i) || i < 0 || i >= committed.outbox.length)
        return err(new StorageError("Outbox row not found"));
      delivered.add(i);
      return ok(undefined);
    },
  };

  let queue: Promise<unknown> = Promise.resolve();

  function run<T, E>(
    work: (tx: Transaction) => Promise<Result<T, E>>,
    signal?: CancelSignal,
  ): AsyncResult<T, E | StorageError | Cancelled> {
    const job = async (): Promise<Result<T, E | StorageError | Cancelled>> => {
      if (signal?.aborted) return err(new Cancelled());
      const draft = copy(committed);
      const outbox: Transaction["outbox"] = {
        append: async (entry) => {
          const failure = fail();
          if (failure) return err(failure);
          draft.outbox.push(copy(entry));
          return ok(undefined);
        },
      };
      const result = await work({
        repositories: writers(() => draft),
        outbox,
        events: eventSinkOver(outbox),
      });
      if (signal?.aborted) return err(new Cancelled());
      if (result.ok) committed = draft;
      return result;
    };
    // A throw rolls back by never swapping the draft in; the chain keeps going for the next run.
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    uow: { reads: readers(() => committed), run },
    committedOutbox: async () => copy(committed.outbox),
    snapshot: async () =>
      copy(
        Object.fromEntries(
          Object.entries(committed).map(([name, rows]) => [
            name,
            rows instanceof Map ? [...rows.values()] : rows,
          ]),
        ),
      ),
    outboxStore,
    faults,
  };
}
