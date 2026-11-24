import { EmptyState } from "@pochimail/ui/components/empty-state";
import { Skeleton } from "@pochimail/ui/components/skeleton";
import { type T, useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { UserLocale } from "@pochimail/ui/i18n/messages.ts";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import type { OutputOf } from "#shared/ipc/contract.ts";
import { CATEGORY_LABELS } from "../../lib/category-labels.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { PAGE_MAIN_CLASS, PageHeading, SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";

type Review = OutputOf<"review.get">;

/** One row per stored signal; the labels come from the catalog, never from a stored row (ADR 0014). */
const COUNT_ROWS = [
  { count: "toReview", label: "review.counts.toReview" },
  { count: "waiting", label: "review.counts.waiting" },
  { count: "deadlines", label: "review.counts.deadlines" },
  { count: "important", label: "review.counts.important" },
] as const;

function OnlineNote({ t }: { readonly t: T }) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-xl bg-card p-5 shadow-sm"
    >
      <h2 className={SECTION_TITLE_CLASS}>{t("review.online.title")}</h2>
      <p className="m-0 text-ui leading-normal text-muted-foreground">{t("review.online.body")}</p>
    </section>
  );
}

function Counts({
  data,
  locale,
  t,
}: {
  readonly data: Review;
  readonly locale: UserLocale;
  readonly t: T;
}) {
  return (
    <section aria-labelledby="review-counts" className="flex flex-col gap-4">
      <h2 id="review-counts" className={SECTION_TITLE_CLASS}>
        {t("review.counts.title")}
      </h2>
      <dl className="grid grid-cols-2 gap-4">
        {COUNT_ROWS.map((row) => (
          <div key={row.count}>
            <dd className="font-display text-figure font-title tabular-nums">
              {data[row.count].toLocaleString(locale)}
            </dd>
            <dt className="text-ui text-muted-foreground">{t(row.label)}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CleanableCounts({
  data,
  locale,
  t,
}: {
  readonly data: Review;
  readonly locale: UserLocale;
  readonly t: T;
}) {
  return (
    <section aria-labelledby="review-cleanable" className="flex flex-col gap-4">
      <h2 id="review-cleanable" className={SECTION_TITLE_CLASS}>
        {t("review.cleanable.title")}
      </h2>
      {data.cleanable.length === 0 ? (
        <p className="text-ui text-muted-foreground">{t("overview.nothingToClean")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y p-0">
          {data.cleanable.map((row) => (
            <li key={row.category} className="flex items-baseline justify-between gap-4 py-2.5">
              <span className="text-ui">{t(CATEGORY_LABELS[row.category])}</span>
              <span className="font-display text-body font-title tabular-nums">
                {row.count.toLocaleString(locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The offline Review screen: the counts the worker stored, plus the design's connection note when
 * no account is stored for the selection. It never reads or renders mail content (ADR 0014).
 */
export function ReviewPage() {
  const t = useT();
  const locale = useLocale();
  const client = useWorkerClient();
  const { account } = useSearch({ strict: false });
  const review = useQuery({
    queryKey: queryKeys.review(account),
    queryFn: () => client.call("review.get", account === undefined ? {} : { accountId: account }),
  });
  const data = review.data;

  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={t("overview.review")} />
      {review.isPending && (
        <div role="status" aria-label={t("review.loading")} className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
        </div>
      )}
      {review.isError && (
        <EmptyState
          title={t("review.error.title")}
          action={{ label: t("overview.retry"), onClick: () => void review.refetch() }}
        />
      )}
      {data !== undefined && (
        <div className="flex flex-col gap-8">
          {data.noAccount ? <OnlineNote t={t} /> : null}
          <Counts data={data} locale={locale} t={t} />
          <CleanableCounts data={data} locale={locale} t={t} />
        </div>
      )}
    </main>
  );
}
