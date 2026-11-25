import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import { Cancelled, NotFound } from "@pochimail/kernel/errors";
import type { EventEnvelope } from "@pochimail/kernel/event";
import { err, ok } from "@pochimail/kernel/result";
import { fakeSenderHash } from "@pochimail/kernel/testing/fake-sender-hash";
import type { Suggestion } from "../model/suggestion.ts";
import type { AccountFigures, DecisionFact, MessageFact } from "../ports/mailbox-facts.ts";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";
import { ACCOUNT_1, idOf, type Seeder, WS_A } from "./samples.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const byText = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

interface StoredFact extends MessageFact {
  readonly seq: number;
  readonly decision: Omit<DecisionFact, "messageId"> | null;
  readonly signals: readonly { readonly kind: string; readonly confidence: number }[];
}
interface Data {
  suggestions: Map<string, Suggestion>;
  digestState: Map<string, { at: string; sequence: number }>;
}
const empty = (): Data => ({ suggestions: new Map(), digestState: new Map() });
const clone = (d: Data): Data => ({
  suggestions: new Map(d.suggestions),
  digestState: new Map(d.digestState),
});

export interface InMemoryCleanup extends Seeder {
  readonly uow: CleanupUnitOfWork;
  /** Events committed so far, in order; a rolled-back transaction leaves none. */
  committedEvents(): readonly EventEnvelope[];
}

/** Cleanup's rows and events in memory over seeded plain facts, with commit-or-roll-back like the real unit of work. */
export function createInMemoryCleanup(): InMemoryCleanup {
  let committed = empty();
  let events: EventEnvelope[] = [];
  const facts = new Map<string, StoredFact>();
  let counter = 0;

  const mailboxFacts: CleanupUnitOfWork["reads"]["mailboxFacts"] = {
    accountIds: async () => ok(facts.size === 0 ? [] : [ACCOUNT_1]),
    query: async (ws, q) => {
      const rows = [...facts.entries()]
        .filter(([key]) => key.startsWith(`${ws}/`))
        .map(([, f]) => f)
        .filter(
          (f) =>
            (q.afterSequence === undefined || f.seq > q.afterSequence) &&
            (q.throughSequence === undefined || f.seq <= q.throughSequence),
        )
        .sort((a, b) => byText(b.receivedAt, a.receivedAt) || byText(a.id, b.id));
      const start = q.cursor === undefined ? 0 : Number(q.cursor);
      const items = rows
        .slice(start, start + q.limit)
        .map(({ seq: _seq, decision: _d, signals: _s, ...fact }) => copy(fact));
      const end = start + items.length;
      return ok({ items, nextCursor: end < rows.length ? String(end) : null });
    },
    latestSequence: async () => ok(Math.max(0, ...[...facts.values()].map((f) => f.seq))),
    figures: async (ws, accountIds) => {
      // The fake holds no action log, so the action-derived figures (archived, deletable,
      // unsubscribed) are truly 0 here; the repositories contract exercises them on the real stores.
      if (facts.size === 0 || !accountIds.includes(ACCOUNT_1)) return ok([]);
      const totals = { savedCount: 0, savedSize: 0, totalSize: 0 };
      for (const [k, f] of facts) {
        if (!k.startsWith(`${ws}/`)) continue;
        totals.savedCount += f.savedCount ?? 0;
        totals.savedSize += f.savedSize ?? 0;
        totals.totalSize += f.size ?? 0;
      }
      const row: AccountFigures = {
        accountId: ACCOUNT_1,
        archived: 0,
        deletableSize: 0,
        unsubscribed: 0,
        ...totals,
      };
      return ok([row]);
    },
    decisions: async (ws, ids) =>
      ok(
        ids.flatMap((id) => {
          const f = facts.get(`${ws}/${id}`);
          return f?.decision ? [{ messageId: id, ...f.decision }] : [];
        }),
      ),
    signals: async (ws, _accountId, ids) => {
      const out = [];
      for (const id of [...ids].sort()) {
        const f = facts.get(`${ws}/${id}`);
        if (!f) return err(new NotFound("Message"));
        for (const s of [...f.signals].sort((a, b) => byText(a.kind, b.kind)))
          out.push({ messageId: id, ...s });
      }
      return ok(out);
    },
  };

  const reads = (data: () => Data): CleanupUnitOfWork["reads"] => ({
    mailboxFacts,
    suggestions: {
      get: async (ws, id) => {
        const s = data().suggestions.get(`${ws}/${id}`);
        return s ? ok(copy(s)) : err(new NotFound("Suggestion"));
      },
      listPending: async (ws, page) => {
        const rows = [...data().suggestions.values()]
          .filter((s) => s.workspaceId === ws && s.state === "pending")
          .sort((a, b) => byText(a.createdAt, b.createdAt) || byText(a.id, b.id));
        const start = page.cursor === undefined ? 0 : Number(page.cursor);
        const items = rows.slice(start, start + page.limit).map(copy);
        const end = start + items.length;
        return ok({ items, nextCursor: end < rows.length ? String(end) : null });
      },
    },
    digestState: {
      get: async (ws, accountId) => ok(data().digestState.get(`${ws}/${accountId}`)?.at ?? null),
      getSequence: async (ws, accountId) =>
        ok(data().digestState.get(`${ws}/${accountId}`)?.sequence ?? 0),
    },
  });

  const uow: CleanupUnitOfWork = {
    reads: reads(() => committed),
    run: async (work, signal) => {
      if (signal?.aborted) return err(new Cancelled());
      const draft = clone(committed);
      const pending: EventEnvelope[] = [];
      const r = reads(() => draft);
      const result = await work({
        repositories: {
          suggestions: {
            ...r.suggestions,
            save: async (s) => {
              draft.suggestions.set(`${s.workspaceId}/${s.id}`, copy(s));
              return ok(undefined);
            },
          },
          digestState: {
            ...r.digestState,
            set: async (ws, accountId, at, sequence) => {
              draft.digestState.set(`${ws}/${accountId}`, {
                at,
                sequence: sequence ?? draft.digestState.get(`${ws}/${accountId}`)?.sequence ?? 0,
              });
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
    eventTypes: async () => events.map((e) => e.type),
    seed: async (rows) => {
      for (const [key, row] of Object.entries(rows)) {
        const n = Number(key);
        const id = idOf(n);
        const existing = facts.get(`${WS_A}/${id}`);
        const { from = "sender@example.com", ...message } = row.message ?? {};
        facts.set(`${WS_A}/${id}`, {
          id,
          senderHash: fakeSenderHash(ACCOUNT_1, from),
          category: row.category ?? "notifications",
          receivedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
          opened: false,
          hasListUnsubscribe: false,
          ...message,
          seq: existing?.seq ?? ++counter,
          decision: row.undecided
            ? null
            : {
                reason: row.reason ?? "Weekly newsletter, never opened",
                confidence: row.confidence ?? 0.9,
              },
          signals: [
            ...(row.signals ?? []).map((kind) => ({ kind, confidence: 1 })),
            ...(row.unsureSignals ?? []).map((kind) => ({ kind, confidence: UNSURE_BELOW - 0.1 })),
          ],
        });
      }
    },
  };
}
