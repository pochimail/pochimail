import type { Category } from "@pochimail/classification/model/category";
import type { T } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import type { OutputOf } from "#shared/ipc/contract.ts";

export type OverviewData = OutputOf<"overview.get">;
type Cleanable = OverviewData["cleanable"][number]["category"];

/** The list a Review button opens. A target holds no email id, so no message is pre-selected. */
export type ReviewTarget = {
  readonly category: Category;
  readonly review: "waiting" | "deadlines" | "important" | "delete" | "archive" | "unsubscribe";
};

export type RowView = {
  readonly id: string;
  readonly count: number;
  readonly label: string;
  readonly detail: string | undefined;
  readonly review: ReviewTarget;
};

export type CleanRowView = RowView & { readonly freesSpace: boolean };

/** The action each known cleanable category feeds. Only delete rows free space (ADR 0012). */
const CATEGORY_ACTION: Record<Cleanable, ReviewTarget["review"]> = {
  newsletters: "unsubscribe",
  promotions: "delete",
  notifications: "archive",
  "sign-ins-security": "delete",
};

const ACTION_ORDER: Record<ReviewTarget["review"], number> = {
  delete: 0,
  archive: 1,
  unsubscribe: 2,
  waiting: 3,
  deadlines: 4,
  important: 5,
};

const CATEGORY_COPY: Record<Cleanable, { sentence: MessageKey; reason: MessageKey }> = {
  newsletters: {
    sentence: "overview.rec.newsletters.sentence",
    reason: "overview.rec.newsletters.reason",
  },
  promotions: {
    sentence: "overview.rec.promotions.sentence",
    reason: "overview.rec.promotions.reason",
  },
  notifications: {
    sentence: "overview.rec.notifications.sentence",
    reason: "overview.rec.notifications.reason",
  },
  "sign-ins-security": {
    sentence: "overview.rec.signins.sentence",
    reason: "overview.rec.signins.reason",
  },
};

export type OverviewView = "loading" | "error" | "empty" | "content";

/** What the screen shows: skeletons until the first answer, an error with retry when the first answer failed, the empty state for an account with no emails, else the figures. */
export const overviewView = (
  data: OverviewData | undefined,
  scanning: boolean,
  failed: boolean,
): OverviewView => {
  if (data === undefined) return failed ? "error" : "loading";
  return data.scanned === 0 && !scanning ? "empty" : "content";
};

/** Emails sorted by action, so delete comes before archive and unsubscribe; each row keeps its own Review target. */
export const cleanRows = (data: OverviewData, t: T): CleanRowView[] =>
  data.cleanable
    .map((item) => {
      const copy = CATEGORY_COPY[item.category];
      return {
        id: item.category,
        count: item.count,
        label: t(copy.sentence),
        detail: t(copy.reason),
        review: { category: item.category, review: CATEGORY_ACTION[item.category] },
        freesSpace: CATEGORY_ACTION[item.category] === "delete",
      };
    })
    .sort((a, b) => ACTION_ORDER[a.review.review] - ACTION_ORDER[b.review.review]);

/** The count figure comes from delete rows alone; archive and unsubscribe can never change it. */
export const cleanSplit = (data: OverviewData) => {
  const deletable = data.cleanable
    .filter((item) => CATEGORY_ACTION[item.category] === "delete")
    .reduce((sum, item) => sum + item.count, 0);
  return { deletable, keep: Math.max(0, data.scanned - deletable) };
};

/** Rows with a protecting signal are shown as catch rows, each with its own Review target. */
export const signalRows = (data: OverviewData, t: T): RowView[] => {
  const rows: RowView[] = [];
  if (data.waiting > 0)
    rows.push({
      id: "waiting",
      count: data.waiting,
      label: t("overview.waiting.title", { count: data.waiting }),
      detail:
        data.oldestWaitingDays > 0
          ? t("overview.waiting.detail", { days: data.oldestWaitingDays })
          : undefined,
      review: { category: "people", review: "waiting" },
    });
  if (data.deadlines > 0)
    rows.push({
      id: "deadlines",
      count: data.deadlines,
      label: t("overview.deadlines.title", { count: data.deadlines }),
      detail: t("overview.deadlines.detail"),
      review: { category: "people", review: "deadlines" },
    });
  if (data.important > 0)
    rows.push({
      id: "important",
      count: data.important,
      label: t("overview.important.title", { count: data.important }),
      detail: t("overview.important.detail"),
      review: { category: "people", review: "important" },
    });
  return rows;
};

const GB = 1e9;

/** Bytes to whole-or-one-decimal units for the locale-formatted size keys (#114). */
const toGb = (bytes: number): number => Math.round((bytes / GB) * 10) / 10;
const toMb = (bytes: number): number => Math.round((bytes / 1e6) * 10) / 10;

/** One locale-formatted size: MB under 1 GB, so small fixtures never round to 0 GB. */
export const sizeLabel = (bytes: number, t: T): string =>
  bytes < GB
    ? t("overview.size.mb", { size: toMb(bytes) })
    : t("overview.size.gb", { size: toGb(bytes) });

/** The free-space sentence uses the same unit as the two sizes it reports. */
export const freeSizeLabel = (sizeBytes: number, totalBytes: number, t: T): string =>
  totalBytes < GB
    ? t("overview.size.freeMb", { size: toMb(sizeBytes), total: toMb(totalBytes) })
    : t("overview.size.free", { size: toGb(sizeBytes), total: toGb(totalBytes) });

/** One cumulative action figure for the Overview; only positive figures are shown, never a zero. */
export type OverviewFigure = {
  readonly count: number;
  readonly labelKey: MessageKey;
  /** Byte size appended to the label via storageBar.legendItem, when the figure carries one. */
  readonly sizeBytes?: number;
};

/** The archived / saved / unsubscribed figures (#114), largest presentation order kept stable. */
export const overviewFigures = (data: OverviewData): OverviewFigure[] => {
  const { archived, savedCount, savedSize, unsubscribed } = data.figures;
  const figures: OverviewFigure[] = [];
  if (archived > 0) figures.push({ count: archived, labelKey: "summary.figure.archived" });
  if (savedCount > 0)
    figures.push({
      count: savedCount,
      labelKey: "summary.figure.saved",
      sizeBytes: savedSize,
    });
  if (unsubscribed > 0)
    figures.push({ count: unsubscribed, labelKey: "summary.figure.unsubscribed" });
  return figures;
};
