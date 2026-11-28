import type { EmailType } from "@pochimail/classification/model/email-type";
import type { T } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import type { OutputOf } from "#shared/ipc/contract.ts";

export type OverviewData = OutputOf<"overview.get">;
type Cleanable = OverviewData["cleanable"][number]["category"];

/** The list a Review button opens. A target holds no email id, so no message is pre-selected. */
export type ReviewTarget = {
  readonly category: EmailType;
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

/** The action each cleanable type feeds. Only delete rows free space (ADR 0012). */
const TYPE_ACTION: Record<Cleanable, ReviewTarget["review"]> = {
  newsletter: "unsubscribe",
  promotion: "delete",
  notification: "archive",
};

const ACTION_ORDER: Record<ReviewTarget["review"], number> = {
  delete: 0,
  archive: 1,
  unsubscribe: 2,
  waiting: 3,
  deadlines: 4,
  important: 5,
};

const TYPE_COPY: Record<Cleanable, { sentence: MessageKey; reason: MessageKey }> = {
  newsletter: {
    sentence: "overview.rec.newsletters.sentence",
    reason: "overview.rec.newsletters.reason",
  },
  promotion: {
    sentence: "overview.rec.promotions.sentence",
    reason: "overview.rec.promotions.reason",
  },
  notification: {
    sentence: "overview.rec.notifications.sentence",
    reason: "overview.rec.notifications.reason",
  },
};

export type OverviewView = "loading" | "error" | "empty" | "syncing" | "content";

/** What the screen shows: skeletons until the first answer, an error with retry when the first answer failed, the connect prompt only when there is no account, the syncing state for an account with no emails yet, else the figures. */
export const overviewView = (
  data: OverviewData | undefined,
  scanning: boolean,
  failed: boolean,
  hasAccount: boolean,
): OverviewView => {
  if (data === undefined) return failed ? "error" : "loading";
  if (data.scanned > 0 || scanning) return "content";
  return hasAccount ? "syncing" : "empty";
};

/** Emails sorted by action, so delete comes before archive and unsubscribe; each row keeps its own Review target. */
export const cleanRows = (data: OverviewData, t: T): CleanRowView[] =>
  data.cleanable
    .map((item) => {
      const copy = TYPE_COPY[item.category];
      return {
        id: item.category,
        count: item.count,
        label: t(copy.sentence),
        detail: t(copy.reason),
        review: { category: item.category, review: TYPE_ACTION[item.category] },
        freesSpace: TYPE_ACTION[item.category] === "delete",
      };
    })
    .sort((a, b) => ACTION_ORDER[a.review.review] - ACTION_ORDER[b.review.review]);

/** The count figure comes from delete rows alone; archive and unsubscribe can never change it. */
export const cleanSplit = (data: OverviewData) => {
  const deletable = data.cleanable
    .filter((item) => TYPE_ACTION[item.category] === "delete")
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
      review: { category: "personal", review: "waiting" },
    });
  if (data.deadlines > 0)
    rows.push({
      id: "deadlines",
      count: data.deadlines,
      label: t("overview.deadlines.title", { count: data.deadlines }),
      detail: t("overview.deadlines.detail"),
      review: { category: "personal", review: "deadlines" },
    });
  if (data.important > 0)
    rows.push({
      id: "important",
      count: data.important,
      label: t("overview.important.title", { count: data.important }),
      detail: t("overview.important.detail"),
      review: { category: "personal", review: "important" },
    });
  return rows;
};

const GB = 1e9;
const MB = 1e6;

/** Bytes to whole-or-one-decimal units for the locale-formatted size keys (#114). */
const toGb = (bytes: number): number => Math.round((bytes / GB) * 10) / 10;
const toMb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10;
/** A nonzero size that rounds to 0.0 MB must not claim to be zero. */
const isUnderTenthMb = (bytes: number, mb: number): boolean => bytes > 0 && mb < 0.1;

/** One locale-formatted size: the unit follows the rounded value, not the raw byte count. */
export const sizeLabel = (bytes: number, t: T): string => {
  const gb = toGb(bytes);
  if (gb >= 1) return t("overview.size.gb", { size: gb });
  const mb = toMb(bytes);
  return isUnderTenthMb(bytes, mb)
    ? t("overview.size.underTenthMb")
    : t("overview.size.mb", { size: mb });
};

/** Each figure picks its own rounded unit: a 12 MB freed size beside a 1 GB total stays readable. */
export const freeSizeLabel = (sizeBytes: number, totalBytes: number, t: T): string => {
  const gb = toGb(sizeBytes);
  const totalGb = toGb(totalBytes);
  if (gb >= 1) return t("overview.size.free", { size: gb, total: totalGb });
  const mb = toMb(sizeBytes);
  const underTenth = isUnderTenthMb(sizeBytes, mb);
  if (totalGb >= 1)
    return underTenth
      ? t("overview.size.freeUnderTenthMixed", { total: totalGb })
      : t("overview.size.freeMixed", { size: mb, total: totalGb });
  const totalMb = toMb(totalBytes);
  return underTenth
    ? t("overview.size.freeUnderTenthMb", { total: totalMb })
    : t("overview.size.freeMb", { size: mb, total: totalMb });
};

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
  if (archived > 0) figures.push({ count: archived, labelKey: "overview.figure.archived" });
  if (savedCount > 0)
    figures.push({
      count: savedCount,
      labelKey: "overview.figure.saved",
      sizeBytes: savedSize,
    });
  if (unsubscribed > 0)
    figures.push({ count: unsubscribed, labelKey: "overview.figure.unsubscribed" });
  return figures;
};
