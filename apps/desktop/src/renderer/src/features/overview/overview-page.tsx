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
import { cn } from "@pochimail/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { queryKeys } from "../../lib/query/keys.ts";
import { type ScanStatus, useScanStatus } from "../../lib/scan-status.tsx";
import { PAGE_MAIN_CLASS, PageHeading, SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { cleanSplit, overviewView, RECOMMENDATION_COPY } from "./overview-figures.ts";

const scanStatusLine = (scan: ScanStatus, t: T): string => {
  if (scan.paused) return t("overview.scan.paused");
  if (scan.total === null) return t("overview.scan.progressNoTotal", { processed: scan.processed });
  return t("overview.scan.progress", { processed: scan.processed, total: scan.total });
};

export function OverviewPage() {
  const t = useT();
  const client = useWorkerClient();
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
  const review = (category: Category) =>
    void navigate({
      to: "/category/$categoryId",
      params: { categoryId: category },
      search: (prev) => prev,
    });

  const view = overviewView(data, scan.active, overview.isError);
  const { cleanable: cleanableTotal, keep } =
    data === undefined ? { cleanable: 0, keep: 0 } : cleanSplit(data);

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
        title={t("overview.title")}
        note={accounts.data ? t("overview.accounts", { count: scopedAccounts.length }) : undefined}
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
        <div className="grid gap-8 @min-desktop:grid-cols-2 @min-desktop:gap-x-12">
          <section aria-labelledby="catch-title" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id="catch-title" className={SECTION_TITLE_CLASS}>
                {t("overview.catch.title")}
              </h2>
              <span className="text-ui text-muted-foreground">{t("overview.catch.note")}</span>
            </div>
            {data.toReview === 0 ? (
              <p className="text-muted-foreground">{t("overview.nothingToCatch")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y p-0">
                {data.waiting > 0 ? (
                  <SignalRow
                    figure={data.waiting.toLocaleString(locale)}
                    title={t("overview.waiting.title", { count: data.waiting })}
                    detail={
                      data.oldestWaitingDays > 0
                        ? t("overview.waiting.detail", { days: data.oldestWaitingDays })
                        : undefined
                    }
                    reviewLabel={t("overview.review")}
                    onReview={() => review("people")}
                  />
                ) : null}
                {data.deadlines > 0 ? (
                  <SignalRow
                    figure={data.deadlines.toLocaleString(locale)}
                    title={t("overview.deadlines.title", { count: data.deadlines })}
                    detail={t("overview.deadlines.detail")}
                    reviewLabel={t("overview.review")}
                    onReview={() => review("people")}
                  />
                ) : null}
                {data.important > 0 ? (
                  <SignalRow
                    figure={data.important.toLocaleString(locale)}
                    title={t("overview.important.title", { count: data.important })}
                    detail={t("overview.important.detail")}
                    reviewLabel={t("overview.review")}
                    onReview={() => review("people")}
                  />
                ) : null}
              </ul>
            )}
          </section>

          <section aria-labelledby="clean-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id="clean-title" className={SECTION_TITLE_CLASS}>
                {t("overview.clean.title")}
              </h2>
              <span className="text-ui text-muted-foreground">{t("overview.clean.note")}</span>
            </div>
            {data.cleanable.length === 0 ? (
              <p className="text-muted-foreground">{t("overview.nothingToClean")}</p>
            ) : (
              <>
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-figure leading-none font-title tabular-nums">
                    {cleanableTotal.toLocaleString(locale)}
                  </span>
                  <span className="text-muted-foreground">
                    {t("overview.clean.headline", { total: data.scanned })}
                  </span>
                </p>
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
                      id: "clean",
                      label: t("overview.clean.free"),
                      value: cleanableTotal,
                      size: t("overview.email.count", { count: cleanableTotal }),
                      pattern: "hatched" as const,
                    },
                  ]}
                />
                <ul className="m-0 flex list-none flex-col divide-y p-0">
                  {data.cleanable.map((item) => (
                    <RecommendationRow
                      key={item.category}
                      sentence={t(RECOMMENDATION_COPY[item.category].sentence)}
                      reason={t(RECOMMENDATION_COPY[item.category].reason)}
                      size={t("overview.email.count", { count: item.count })}
                      reviewLabel={t("overview.review")}
                      onReview={() => review(item.category)}
                    />
                  ))}
                </ul>
              </>
            )}
            <p className="text-ui text-muted-foreground">{t("overview.clean.never")}</p>
          </section>
        </div>
      )}
    </main>
  );
}
