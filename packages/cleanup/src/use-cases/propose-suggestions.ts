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
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import type { SuggestionCreated } from "../events.ts";
import {
  createSuggestion,
  type Recommendation,
  type Suggestion,
  SuggestionId,
} from "../model/suggestion.ts";
import { PROPOSABLE_LABELS } from "../policies/labels.ts";
import type { DecisionFact, MailboxFacts, MessageFact } from "../ports/mailbox-facts.ts";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";

const PAGE = 200;
/** Never suggest from a sender with fewer emails than this: one email is not a pattern. */
export const MIN_SENDER_MESSAGES = 3;

export interface ProposeSuggestionsDeps {
  readonly uow: CleanupUnitOfWork;
  readonly clock: Clock;
  /** Labels whose mail is never proposed for cleanup (brief §2, ADR 0012); the composition names them, classification owns the labels. */
  readonly protectedLabels: readonly string[];
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
 * Only archive and unsubscribe are ever proposed (delete moves to Trash with approval, ADR 0012) and never for a sender who has
 * People mail, a protected category (brief §2). The reason and confidence come from what the
 * classifier recorded for the sender's messages. Re-running creates nothing twice and never
 * resets a suggestion the user already approved or dismissed.
 */
export class ProposeSuggestions {
  constructor(private readonly deps: ProposeSuggestionsDeps) {}

  async execute(
    request: ProposeSuggestionsRequest,
    signal: CancelSignal,
  ): AsyncResult<readonly Suggestion[], ProposeSuggestionsError> {
    const { uow, clock } = this.deps;
    const collected = await collect(uow.reads.mailboxFacts, request);
    if (!collected.ok) return collected;

    const createdAt = clock.now().toISOString();
    const proposals: Suggestion[] = [];
    for (const [sender, rows] of [...collected.value].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!mayPropose(rows, this.deps.protectedLabels)) continue;
      const proposal = propose(rows);
      if (!proposal) continue;
      const id = SuggestionId(`sug:${request.accountId}:${sender}:${proposal.kind}`);
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
}

async function collect(
  facts: MailboxFacts,
  request: ProposeSuggestionsRequest,
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
    const decisions = await facts.decisions(
      request.workspaceId,
      page.value.items.map((m) => m.id),
    );
    if (!decisions.ok) return decisions;
    const byId = new Map(decisions.value.map((d) => [d.messageId, d]));
    for (const message of page.value.items) {
      const rows = bySender.get(message.from) ?? [];
      rows.push({ message, decision: byId.get(message.id) ?? null });
      bySender.set(message.from, rows);
    }
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ok(bySender);
}

function mayPropose(rows: readonly Row[], protectedLabels: readonly string[]): boolean {
  if (rows.length < MIN_SENDER_MESSAGES) return false;
  if (rows.some((r) => protectedLabels.includes(r.message.category))) return false;
  if (!rows.every((r) => PROPOSABLE_LABELS.includes(r.message.category))) return false;
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
