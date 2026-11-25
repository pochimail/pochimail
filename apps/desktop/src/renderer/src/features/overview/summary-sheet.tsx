import type { EmailType } from "@pochimail/classification/model/email-type";
import { Button } from "@pochimail/ui/components/button";
import { PillRadioGroup, PillRadioGroupItem } from "@pochimail/ui/components/pill-radio-group";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pochimail/ui/components/sheet";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { TIDY_CADENCES, type TidyCadence } from "#shared/settings.ts";
import { typeLabelKey } from "../../lib/type-labels.ts";
import { type Digest, summaryView } from "./summary-view-model.ts";
import { SUMMARY_FOCUS_TARGET_ID } from "./use-summary-sheet.ts";

const CADENCE_LABELS: Readonly<Record<TidyCadence, MessageKey>> = {
  "as-it-arrives": "summary.tidy.asItArrives",
  daily: "summary.tidy.daily",
  weekly: "summary.tidy.weekly",
  "on-request": "summary.tidy.onRequest",
};

export type SummarySheetProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly digest: Digest | undefined;
  readonly device: string;
  readonly cadence: TidyCadence;
  readonly onCadenceChange: (cadence: TidyCadence) => void;
  readonly onReview: (category: EmailType) => void;
};

/** The summary sheet over the Overview: new figures, one Review route and the cadence choice. */
export function SummarySheet({
  open,
  onOpenChange,
  digest,
  device,
  cadence,
  onCadenceChange,
  onReview,
}: SummarySheetProps) {
  const t = useT();
  const locale = useLocale();
  const view = summaryView(digest);
  const review = view.review;
  const reviewTypeKey = review === undefined ? undefined : typeLabelKey(review.category);
  const reviewType = reviewTypeKey === undefined ? review?.category : t(reviewTypeKey);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm">
          {t("overview.viewSummary")}
        </Button>
      </SheetTrigger>
      <SheetContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(SUMMARY_FOCUS_TARGET_ID)?.focus();
        }}
      >
        <SheetHeader>
          {view.generatedAt === undefined ? null : (
            <p className="text-ui text-muted-foreground">
              {t("summary.from", { date: view.generatedAt, device })}
            </p>
          )}
          <SheetTitle>{t("summary.title")}</SheetTitle>
          <SheetDescription>{t("summary.sentence", { count: view.itemCount })}</SheetDescription>
        </SheetHeader>

        {view.figures.length === 0 ? (
          <p className="text-ui text-muted-foreground">{t("summary.nothingNew")}</p>
        ) : (
          <dl className="grid grid-cols-3 gap-4">
            {view.figures.map((figure) => (
              <div key={figure.labelKey} className="flex flex-col-reverse">
                <dt className="text-ui text-muted-foreground">{t(figure.labelKey)}</dt>
                <dd className="font-display text-3xl tabular-nums">
                  {figure.count.toLocaleString(locale)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {review === undefined ? null : (
          <section
            aria-labelledby="summary-where-start"
            className="flex flex-col gap-3 rounded-xl bg-muted p-4"
          >
            <div className="flex flex-col gap-1">
              <h2 id="summary-where-start" className="font-semibold">
                {t("summary.whereStart.title")}
              </h2>
              <p className="text-ui">
                {t("summary.whereStart.detail", { category: reviewType ?? review.category })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onReview(review.category)}>
                {t("summary.reviewCount", { count: review.count })}
              </Button>
              <SheetClose asChild>
                <Button variant="ghost">{t("summary.later")}</Button>
              </SheetClose>
            </div>
          </section>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-ui font-semibold">
            {t("summary.tidy")}{" "}
            <span className="font-normal text-muted-foreground">{t("summary.tidy.hint")}</span>
          </p>
          <PillRadioGroup
            value={cadence}
            aria-label={t("summary.tidy")}
            onValueChange={(value) => {
              const next = TIDY_CADENCES.find((option) => option === value);
              if (next !== undefined) onCadenceChange(next);
            }}
          >
            {TIDY_CADENCES.map((option) => (
              <PillRadioGroupItem key={option} value={option}>
                {t(CADENCE_LABELS[option])}
              </PillRadioGroupItem>
            ))}
          </PillRadioGroup>
          <p className="text-ui text-muted-foreground">{t("summary.tidy.settings")}</p>
        </div>

        {review === undefined ? (
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="ghost">{t("summary.later")}</Button>
            </SheetClose>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
