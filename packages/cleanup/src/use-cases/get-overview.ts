import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { CLEANABLE_LABELS, type CleanableLabel } from "../policies/labels.ts";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";
import { SummarizeMailbox } from "./summarize-mailbox.ts";

/** The action- and size-derived figures (#114), summed over the selected accounts. Sizes are bytes. */
export interface OverviewFigures {
  /** Emails an applied archive action left out of the inbox. */
  readonly archived: number;
  /** Attachments the stored messages carry; a count only, never a name (ADR 0014). */
  readonly savedCount: number;
  /** Their combined size in bytes. */
  readonly savedSize: number;
  /** Size of the emails whose latest executed trash/untrash effect is trash (ADR 0012). */
  readonly deletableSize: number;
  /** Applied unsubscribe actions; one entry is one sender. */
  readonly unsubscribed: number;
  /** Combined size of the stored emails, for "out of Y GB". */
  readonly totalSize: number;
}

export interface OverviewNumbers {
  /** Emails stored over the selected accounts. */
  readonly scanned: number;
  /** Emails that need the person: waiting for a reply, with a deadline, or from an important sender. */
  readonly toReview: number;
  readonly waiting: number;
  readonly deadlines: number;
  readonly important: number;
  /** Age in whole days of the oldest email still waiting for a reply; 0 when none. */
  readonly oldestWaitingDays: number;
  /** Emails Pochi could propose to clean, per category, largest first; unsure and undecided mail is not counted (ADR 0012). */
  readonly cleanable: readonly { readonly category: CleanableLabel; readonly count: number }[];
  readonly figures: OverviewFigures;
}

/** The figures the Overview leads with, computed from what the scan stored, for all accounts or one. */
export class GetOverview {
  constructor(private readonly deps: { readonly uow: CleanupUnitOfWork; readonly clock: Clock }) {}

  async execute(
    workspaceId: WorkspaceId,
    accountId?: AccountId,
  ): AsyncResult<OverviewNumbers, StorageError | NotFound> {
    const accounts = await this.deps.uow.reads.mailboxFacts.accountIds(workspaceId);
    if (!accounts.ok) return accounts;
    const ids = accounts.value.filter((id) => accountId === undefined || id === accountId);
    const summary = await new SummarizeMailbox(this.deps).execute({ workspaceId, accountIds: ids });
    if (!summary.ok) return summary;
    const rows = await this.deps.uow.reads.mailboxFacts.figures(workspaceId, ids);
    if (!rows.ok) return rows;
    const figures = {
      archived: 0,
      savedCount: 0,
      savedSize: 0,
      deletableSize: 0,
      unsubscribed: 0,
      totalSize: 0,
    };
    for (const row of rows.value) {
      figures.archived += row.archived;
      figures.savedCount += row.savedCount;
      figures.savedSize += row.savedSize;
      figures.deletableSize += row.deletableSize;
      figures.unsubscribed += row.unsubscribed;
      figures.totalSize += row.totalSize;
    }
    const { signals, proposable, waiting, toReview } = summary.value;
    const deadlines = signals["time-sensitive"] ?? 0;
    const important = signals["important-sender"] ?? 0;
    return ok({
      scanned: summary.value.emails,
      toReview,
      waiting,
      deadlines,
      important,
      oldestWaitingDays: summary.value.oldestWaitingDays,
      cleanable: CLEANABLE_LABELS.map((category) => ({
        category,
        count: proposable[category] ?? 0,
      }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count),
      figures,
    });
  }
}
