import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult } from "@pochimail/kernel/common";
import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";

const PAGE = 500;
const DAY_MS = 86_400_000;
const REVIEW_KINDS = ["needs-reply", "time-sensitive", "important-sender"];

export interface SummarizeMailboxRequest {
  readonly workspaceId: WorkspaceId;
  readonly accountIds: readonly AccountId[];
}

/** Counts only: never a subject, address or snippet (brief §5.10). Labels with no email are absent. */
export interface MailboxSummary {
  readonly accounts: number;
  readonly emails: number;
  readonly categories: Readonly<Record<string, number>>;
  /**
   * Emails per label that carry a sure decision: the mail ProposeSuggestions may propose from. An
   * unsure or undecided email is protected (ADR 0012), so it is left out, whatever its label.
   */
  readonly proposable: Readonly<Record<string, number>>;
  /** Emails per signal kind (a message may carry several); only signals the detector is sure of. */
  readonly signals: Readonly<Record<string, number>>;
  /** Emails waiting for a reply that are not also from an important sender, so none counts twice. */
  readonly waiting: number;
  /** Distinct emails that need a reply, have a deadline or come from an important sender. */
  readonly toReview: number;
  /** Age in whole days of the oldest email still needing a reply; 0 when none. */
  readonly oldestWaitingDays: number;
}

/** The mock-dataset summary (brief §6 › Mock data) computed from what the pipeline stored. */
export class SummarizeMailbox {
  constructor(private readonly deps: { readonly uow: CleanupUnitOfWork; readonly clock: Clock }) {}

  async execute(
    request: SummarizeMailboxRequest,
  ): AsyncResult<MailboxSummary, StorageError | NotFound> {
    const { uow, clock } = this.deps;
    const categories: Record<string, number> = {};
    const proposable: Record<string, number> = {};
    const signals: Record<string, number> = {};
    let emails = 0;
    let waiting = 0;
    let toReview = 0;
    let oldestWaiting = 0;
    for (const accountId of request.accountIds) {
      const ids: MessageId[] = [];
      const received = new Map<MessageId, string>();
      let cursor: string | undefined;
      do {
        const page = await uow.reads.mailboxFacts.query(request.workspaceId, {
          accountId,
          limit: PAGE,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) return page;
        const decisions = await uow.reads.mailboxFacts.decisions(
          request.workspaceId,
          page.value.items.map((m) => m.id),
        );
        if (!decisions.ok) return decisions;
        const confident = new Set(
          decisions.value.filter((d) => d.confidence >= UNSURE_BELOW).map((d) => d.messageId),
        );
        for (const m of page.value.items) {
          ids.push(m.id);
          received.set(m.id, m.receivedAt);
          categories[m.category] = (categories[m.category] ?? 0) + 1;
          if (confident.has(m.id)) proposable[m.category] = (proposable[m.category] ?? 0) + 1;
        }
        cursor = page.value.nextCursor ?? undefined;
      } while (cursor !== undefined);
      emails += ids.length;

      const found = await uow.reads.mailboxFacts.signals(
        request.workspaceId,
        accountId,
        ids,
        clock.now(),
      );
      if (!found.ok) return found;
      // An unsure signal protects the email (ADR 0012) but is a guess, so it is never counted.
      const sure = found.value.filter((s) => s.confidence >= UNSURE_BELOW);
      const kindsOf = new Map<MessageId, Set<string>>();
      for (const s of sure) {
        signals[s.kind] = (signals[s.kind] ?? 0) + 1;
        kindsOf.set(s.messageId, (kindsOf.get(s.messageId) ?? new Set()).add(s.kind));
        if (s.kind === "needs-reply") {
          const days = Math.floor(
            (clock.now().getTime() - Date.parse(received.get(s.messageId) ?? "")) / DAY_MS,
          );
          oldestWaiting = Math.max(oldestWaiting, days);
        }
      }
      for (const kinds of kindsOf.values()) {
        if (kinds.has("needs-reply") && !kinds.has("important-sender")) waiting += 1;
        if (REVIEW_KINDS.some((k) => kinds.has(k))) toReview += 1;
      }
    }
    return ok({
      accounts: request.accountIds.length,
      emails,
      categories,
      proposable,
      signals,
      waiting,
      toReview,
      oldestWaitingDays: oldestWaiting,
    });
  }
}
