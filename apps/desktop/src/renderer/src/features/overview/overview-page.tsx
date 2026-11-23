import type { Category } from "@pochimail/classification/model/category";
import { Button } from "@pochimail/ui/components/button";
import { EmptyState } from "@pochimail/ui/components/empty-state";
import { RecommendationRow } from "@pochimail/ui/components/recommendation-row";
import { SignalRow } from "@pochimail/ui/components/signal-row";
import { Skeleton } from "@pochimail/ui/components/skeleton";
import { StatusStrip } from "@pochimail/ui/components/status-strip";
import { StorageBar } from "@pochimail/ui/components/storage-bar";
import { type T, useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { deviceLabel } from "@pochimail/ui/i18n/locale.ts";
import type { UserLocale } from "@pochimail/ui/i18n/messages.ts";
import { cn } from "@pochimail/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { queryKeys } from "../../lib/query/keys.ts";
import { type ScanStatus, useScanStatus } from "../../lib/scan-status.tsx";
import { PAGE_MAIN_CLASS, PageHeading, SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import {
  type CleanRowView,
  cleanRows,
  cleanSplit,
  type OverviewData,
  overviewView,
  type ReviewTarget,
  type RowView,
  signalRows,
} from "./overview-figures.ts";
import { SummarySheet } from "./summary-sheet.tsx";
import { SUMMARY_FOCUS_TARGET_ID, useSummarySheet } from "./use-summary-sheet.ts";

const scanStatusLine = (scan: ScanStatus, t: T): string => {
  if (scan.paused) return t("overview.scan.paused");
  if (scan.total === null) return t("overview.scan.progressNoTotal", { processed: scan.processed });
  return t("overview.scan.progress", { processed: scan.processed, total: scan.total });
};

type SectionProps = {
  t: T;
  locale: UserLocale;
  onReview: (target: ReviewTarget) => void;
};

function CleanUpSection({
  data,
  rows,
  t,
  locale,
  onReview,
}: SectionProps & { data: OverviewData; rows: CleanRowView[] }) {
  const { deletable, keep } = cleanSplit(data);
  const freeingRows = rows.filter((row) => row.freesSpace);
  const otherRows = rows.filter((row) => !row.freesSpace);
  return (
    <section aria-labelledby="clean-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="clean-title" className={SECTION_TITLE_CLASS}>
          {t("overview.clean.title")}
        </h2>
        <span className="text-ui text-muted-foreground">{t("overview.clean.note")}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("overview.nothingToClean")}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-figure leading-none font-title tabular-nums">
              {deletable.toLocaleString(locale)}
            </span>
            <span className="text-muted-foreground">
              {t("overview.clean.headline", { total: data.scanned })}
            </span>
          </p>
          <p className="text-ui text-muted-foreground">{t("overview.clean.sizeUnknown")}</p>
          <StorageBar
            summary={t("overview.clean.summary", { total: data.scanned })}
            segments={[
              ...(keep > 0
                ? [
                    {
                      id: "keep",
                      label: t("overview.clean.keep"),
                      value: keep,
                      size: t("overview.email.count", { count: keep }),
                      pattern: "solid" as const,
                    },
                  ]
                : []),
              {
                id: "deletable",
                label: t("overview.clean.free"),
                value: deletable,
                size: t("overview.email.count", { count: deletable }),
                pattern: "hatched" as const,
              },
            ]}
          />
          <ul className="m-0 flex list-none flex-col divide-y p-0">
            {freeingRows.map((row) => (
              <RecommendationRow
                key={row.id}
                sentence={row.label}
                reason={row.detail}
                size={t("overview.email.count", { count: row.count })}
                reviewLabel={t("overview.review")}
                onReview={() => onReview(row.review)}
              />
            ))}
          </ul>
          {otherRows.length > 0 ? (
            <>
              <h3 className="text-body font-medium">{t("overview.clean.noFreeing")}</h3>
              <ul className="m-0 flex list-none flex-col divide-y p-0">
                {otherRows.map((row) => (
                  <RecommendationRow
                    key={row.id}
                    sentence={row.label}
                    reason={row.detail}
                    size={t("overview.email.count", { count: row.count })}
                    reviewLabel={t("overview.review")}
                    onReview={() => onReview(row.review)}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      <p className="text-ui text-muted-foreground">{t("overview.clean.never")}</p>
    </section>
  );
}

function CatchSection({ rows, t, locale, onReview }: SectionProps & { rows: RowView[] }) {
  return (
    <section aria-labelledby="catch-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="catch-title" className={SECTION_TITLE_CLASS}>
          {t("overview.catch.title")}
        </h2>
        <span className="text-ui text-muted-foreground">{t("overview.catch.note")}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("overview.nothingToCatch")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y p-0">
          {rows.map((row) => (
            <SignalRow
              key={row.id}
              figure={row.count.toLocaleString(locale)}
              title={row.label}
              detail={row.detail}
              reviewLabel={t("overview.review")}
              onReview={() => onReview(row.review)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function OverviewPage() {
  const t = useT();
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const summary = useSummarySheet(client, queryClient);
  const navigate = useNavigate();
  const { account } = useSearch({ strict: false });
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  const deviceName = useQuery({
    queryKey: queryKeys.deviceName(),
    queryFn: () => client.call("device.name"),
  });
  const overview = useQuery({
    queryKey: queryKeys.overview(account),
    queryFn: () => client.call("overview.get", account === undefined ? {} : { accountId: account }),
  });
  const scopedAccounts = (accounts.data ?? []).filter(
    (a) => account === undefined || a.id === account,
  );
  const scan = useScanStatus(scopedAccounts.map((a) => a.id));

  const locale = useLocale();
  const device = deviceLabel(deviceName.data ?? "device", locale);
  const data = overview.data;
  const goToCategory = (category: Category, filter?: ReviewTarget["review"]) =>
    void navigate({
      to: "/category/$categoryId",
      params: { categoryId: category },
      search: (prev) => (filter === undefined ? prev : { ...prev, review: filter }),
    });
  const review = (target: ReviewTarget) => goToCategory(target.category, target.review);

  const view = overviewView(data, scan.active, overview.isError);
  const rows = data === undefined ? [] : cleanRows(data, t);
  const signals = data === undefined ? [] : signalRows(data, t);

  return (
    <main className={cn(PAGE_MAIN_CLASS, "@container")}>
      {scan.active ? (
        <StatusStrip
          progress={scan.percent}
          headline={t("overview.sorting", { device })}
          status={scanStatusLine(scan, t)}
        >
          <Button variant="secondary" size="sm" onClick={scan.paused ? scan.resume : scan.pause}>
            {scan.paused ? t("overview.resume") : t("overview.pause")}
          </Button>
        </StatusStrip>
      ) : null}

      <PageHeading
        id={SUMMARY_FOCUS_TARGET_ID}
        title={t("overview.title")}
        note={accounts.data ? t("overview.accounts", { count: scopedAccounts.length }) : undefined}
        action={
          summary.digest?.ready === true ? (
            <SummarySheet
              open={summary.open}
              onOpenChange={summary.setOpen}
              digest={summary.digest}
              device={device}
              cadence={summary.cadence}
              onCadenceChange={summary.selectCadence}
              onReview={goToCategory}
            />
          ) : undefined
        }
      />

      {view === "loading" && (
        <div role="status" aria-label={t("overview.loading")} className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      )}
      {view === "error" && (
        <EmptyState
          title={t("overview.worker.unavailable")}
          action={{ label: t("overview.retry"), onClick: () => void overview.refetch() }}
        />
      )}
      {view === "empty" && (
        <EmptyState
          title={t("overview.empty.title")}
          description={t("overview.empty.description")}
          action={{
            label: t("overview.empty.action"),
            onClick: () => void navigate({ to: "/connect" }),
          }}
        />
      )}
      {view === "content" && data !== undefined && (
        <div className="flex flex-col gap-8">
          <CleanUpSection data={data} rows={rows} t={t} locale={locale} onReview={review} />
          <CatchSection rows={signals} t={t} locale={locale} onReview={review} />
        </div>
      )}
    </main>
  );
}
