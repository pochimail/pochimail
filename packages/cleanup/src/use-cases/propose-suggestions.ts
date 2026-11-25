import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import type {
  Cancelled,
  InvalidIdError,
  InvalidStateError,
  NotFound,
  StorageError,
} from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import type { SuggestionCreated } from "../events.ts";
import {
  createSuggestion,
  type Recommendation,
  type Suggestion,
  SuggestionId,
} from "../model/suggestion.ts";
import { CLEANABLE_LABELS, PROTECTING_SIGNALS } from "../policies/labels.ts";
import type {
  DecisionFact,
  MailboxFacts,
  MessageFact,
  SignalFact,
} from "../ports/mailbox-facts.ts";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";

const PAGE = 200;
/** Never suggest from a sender with fewer emails than this: one email is not a pattern. */
export const MIN_SENDER_MESSAGES = 3;

export interface ProposeSuggestionsDeps {
  readonly uow: CleanupUnitOfWork;
  readonly clock: Clock;
}

export interface ProposeSuggestionsRequest {
  readonly workspaceId: WorkspaceId;
  readonly accountId: AccountId;
}

export type ProposeSuggestionsError =
  | StorageError
  | NotFound
  | Cancelled
  | InvalidIdError
  | InvalidStateError;

/**
 * Proposes sender-level clean-ups, each with a human-readable reason and a confidence (brief §3).
 *
 * Mail is grouped and each suggestion is keyed by the sender hash, never the address (ADR 0014), so
 * the id is the same after a restart. Only archive and unsubscribe are ever proposed (delete moves
 * to Trash with approval, ADR 0012), and only for senders whose every email is of a cleanable type
 * and carries no protecting signal (ADR 0012): protection reads signals, never a type name. The
 * reason and confidence come from what the classifier recorded for the sender's messages. Re-running
 * creates nothing twice and never resets a suggestion the user already approved or dismissed.
 */
export class ProposeSuggestions {
  constructor(private readonly deps: ProposeSuggestionsDeps) {}

  async execute(
    request: ProposeSuggestionsRequest,
    signal: CancelSignal,
  ): AsyncResult<readonly Suggestion[], ProposeSuggestionsError> {
    const { uow, clock } = this.deps;
    const collected = await collect(uow.reads.mailboxFacts, request, clock.now());
    if (!collected.ok) return collected;

    const createdAt = clock.now().toISOString();
    const proposals: Suggestion[] = [];
    for (const [senderHash, rows] of [...collected.value].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!mayPropose(rows)) continue;
      const proposal = propose(rows);
      if (!proposal) continue;
      const id = SuggestionId(`sug:${request.accountId}:${senderHash}:${proposal.kind}`);
      if (!id.ok) return id;
      const recommendation: Recommendation = {
        kind: proposal.kind,
        messageIds: rows.map((r) => r.message.id),
      };
      const made = createSuggestion({
        schemaVersion: 1,
        id: id.value,
        workspaceId: request.workspaceId,
        accountId: request.accountId,
        recommendation,
        reasons: proposal.reasons,
        confidence: proposal.confidence,
        state: "pending",
        createdAt,
      });
      if (!made.ok) return err(made.error);
      proposals.push(made.value);
    }

    const created: Suggestion[] = [];
    const committed = await uow.run(async (tx) => {
      for (const s of proposals) {
        const existing = await tx.repositories.suggestions.get(s.workspaceId, s.id);
        if (existing.ok) continue;
        if (existing.error.code !== "storage.not_found") return existing;
        const saved = await tx.repositories.suggestions.save(s);
        if (!saved.ok) return saved;
        const event = {
          id: `suggestion:${s.id}`,
          type: "SuggestionCreated",
          version: 1,
          workspaceId: s.workspaceId,
          occurredAt: createdAt,
          payload: {
            suggestionId: s.id,
            accountId: s.accountId,
            kind: s.recommendation.kind,
            messageCount: s.recommendation.messageIds.length,
          },
        } satisfies SuggestionCreated;
        const appended = await tx.events.append([event]);
        if (!appended.ok) return appended;
        created.push(s);
      }
      return ok(undefined);
    }, signal);
    if (!committed.ok) return committed;
    return ok(created);
  }
}

interface Row {
  readonly message: MessageFact;
  readonly decision: DecisionFact | null;
  readonly signals: readonly SignalFact[];
}

/** Each message of a page with its recorded decision and signals. */
async function rowsOf(
  facts: MailboxFacts,
  request: ProposeSuggestionsRequest,
  messages: readonly MessageFact[],
  now: Date,
): AsyncResult<Row[], StorageError | NotFound> {
  const ids = messages.map((m) => m.id);
  const decisions = await facts.decisions(request.workspaceId, ids);
  if (!decisions.ok) return decisions;
  const signals = await facts.signals(request.workspaceId, request.accountId, ids, now);
  if (!signals.ok) return signals;
  const decisionOf = new Map(decisions.value.map((d) => [d.messageId, d]));
  const signalsOf = new Map<MessageId, SignalFact[]>();
  for (const s of signals.value)
    signalsOf.set(s.messageId, [...(signalsOf.get(s.messageId) ?? []), s]);
  return ok(
    messages.map((message) => ({
      message,
      decision: decisionOf.get(message.id) ?? null,
      signals: signalsOf.get(message.id) ?? [],
    })),
  );
}

async function collect(
  facts: MailboxFacts,
  request: ProposeSuggestionsRequest,
  now: Date,
): AsyncResult<Map<string, Row[]>, StorageError | NotFound> {
  const bySender = new Map<string, Row[]>();
  let cursor: string | undefined;
  do {
    const page = await facts.query(request.workspaceId, {
      accountId: request.accountId,
      limit: PAGE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) return page;
    const rows = await rowsOf(facts, request, page.value.items, now);
    if (!rows.ok) return rows;
    for (const row of rows.value) {
      // No hash means the sender is unknown: such mail has no sender to propose a clean-up for.
      if (row.message.senderHash === "") continue;
      bySender.set(row.message.senderHash, [...(bySender.get(row.message.senderHash) ?? []), row]);
    }
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ok(bySender);
}

function mayPropose(rows: readonly Row[]): boolean {
  if (rows.length < MIN_SENDER_MESSAGES) return false;
  if (rows.some((r) => r.signals.some((s) => PROTECTING_SIGNALS.includes(s.kind)))) return false;
  if (!rows.every((r) => CLEANABLE_LABELS.some((label) => label === r.message.category)))
    return false;
  // ADR 0012: an unsure or undecided email is protected, whatever label it was filed under.
  return rows.every((r) => r.decision !== null && r.decision.confidence >= UNSURE_BELOW);
}

function propose(rows: readonly Row[]) {
  const unopened = rows.every((r) => !r.message.opened);
  const confidence = Math.min(0.99, ...rows.map((r) => r.decision?.confidence ?? 0));
  const why = [...new Set(rows.flatMap((r) => (r.decision ? [r.decision.reason] : [])))];
  const evidence = `${rows.length} emails from this sender, ${unopened ? "none" : "some"} opened`;
  if (unopened && rows.every((r) => r.message.hasListUnsubscribe))
    return {
      kind: "unsubscribe" as const,
      confidence,
      reasons: [evidence, ...why],
    };
  if (unopened)
    return { kind: "archive" as const, confidence: confidence * 0.9, reasons: [evidence, ...why] };
  return null;
}
