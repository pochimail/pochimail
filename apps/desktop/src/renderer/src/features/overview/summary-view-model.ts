import type { EmailType } from "@pochimail/classification/model/email-type";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import type { OutputOf } from "#shared/ipc/contract.ts";

export type Digest = OutputOf<"digest.get">;

/** One new-item figure and the Review placeholder that explains it. */
type SummaryFigure = {
  readonly count: number;
  readonly labelKey: MessageKey;
  readonly category: EmailType;
};

export type SummaryViewModel = {
  readonly itemCount: number;
  readonly generatedAt: string | undefined;
  /** Only positive figures: the sheet never shows a cumulative tally or a previous sync's items. */
  readonly figures: readonly SummaryFigure[];
  /** The largest new figure; the first on a tie keeps the choice deterministic. */
  readonly review: SummaryFigure | undefined;
};

const FIGURE_FIELDS = [
  { field: "archived", labelKey: "summary.figure.archived", category: "notification" },
  { field: "saved", labelKey: "summary.figure.saved", category: "transactional" },
  { field: "unsubscribed", labelKey: "summary.figure.unsubscribed", category: "newsletter" },
] as const satisfies readonly {
  readonly field: "archived" | "saved" | "unsubscribed";
  readonly labelKey: MessageKey;
  readonly category: EmailType;
}[];

/** Turns the digest contract into what the sheet can render; the digest already holds new items only. */
export function summaryView(digest: Digest | undefined): SummaryViewModel {
  const figures = FIGURE_FIELDS.flatMap(({ field, labelKey, category }) => {
    const count = digest?.[field] ?? 0;
    return count > 0 ? [{ count, labelKey, category }] : [];
  });
  const review = figures.reduce<SummaryFigure | undefined>(
    (best, figure) => (best === undefined || figure.count > best.count ? figure : best),
    undefined,
  );
  return {
    itemCount: digest?.itemCount ?? 0,
    generatedAt: digest?.generatedAt,
    figures,
    review,
  };
}
