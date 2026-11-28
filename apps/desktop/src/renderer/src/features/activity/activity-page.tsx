import { Button } from "@pochimail/ui/components/button";
import { EmptyState } from "@pochimail/ui/components/empty-state";
import { Skeleton } from "@pochimail/ui/components/skeleton";
import { toast } from "@pochimail/ui/components/sonner";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { InputOf } from "#shared/ipc/contract.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { PAGE_MAIN_CLASS, PageHeading, SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { type ActivityEntry, ActivityRow } from "./activity-row.tsx";

const dayKey = (iso: string) => new Date(iso).toDateString();

/**
 * The action log as the person reads it: newest first, one row per action, Undo per action and per batch.
 * Both undos go through `cleanup.undo`; the list refreshes when the worker reports an applied, failed or undone action.
 */
export function ActivityPage() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const { account } = useSearch({ strict: false });
  const list = useInfiniteQuery({
    queryKey: queryKeys.activity(account),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.call("activity.list", {
        ...(account === undefined ? {} : { accountIds: [account] }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const undo = useMutation({
    mutationFn: (target: InputOf<"cleanup.undo">) => client.call("cleanup.undo", target),
    onError: () => toast.error(t("activity.undoFailed")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const entries: ActivityEntry[] = list.data?.pages.flatMap((page) => page.entries) ?? [];
  const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const labelOf = (iso: string) => {
    if (dayKey(iso) === today.toDateString()) return t("activity.today");
    if (dayKey(iso) === yesterday.toDateString()) return t("activity.yesterday");
    return dateFormat.format(new Date(iso));
  };
  const days = [...new Set(entries.map((entry) => dayKey(entry.at)))];
  const batchSize = (batchId: string | undefined) =>
    batchId === undefined ? 0 : entries.filter((entry) => entry.batchId === batchId).length;

  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={t("activity.title")} note={t("activity.subtitle")} />
      {list.isPending && (
        <div role="status" aria-label={t("activity.loading")} className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {list.isError && (
        <EmptyState
          title={t("activity.error.title")}
          action={{ label: t("overview.retry"), onClick: () => void list.refetch() }}
        />
      )}
      {list.isSuccess && entries.length === 0 && (
        <EmptyState
          className="mt-4"
          role="status"
          pose="happy"
          title={t("state.emptyActivity.title")}
          description={t("state.emptyActivity.body")}
          action={{
            label: t("action.backToOverview"),
            onClick: () => void navigate({ to: "/overview" }),
          }}
        />
      )}
      {entries.length > 0 && (
        <div className="flex flex-col gap-6">
          <p className="m-0 max-w-prose text-ui leading-normal text-muted-foreground">
            {t("activity.intro")}
          </p>
          {days.map((day) => {
            const rows = entries.filter((entry) => dayKey(entry.at) === day);
            const first = rows[0];
            return (
              <section key={day} className="flex flex-col gap-1">
                <h2 className={SECTION_TITLE_CLASS}>{first ? labelOf(first.at) : day}</h2>
                <ul className="m-0 flex list-none flex-col border-t p-0">
                  {rows.map((entry, index) => {
                    const batchId = entry.batchId;
                    const startsBatch =
                      batchId !== undefined &&
                      batchSize(batchId) > 1 &&
                      rows.findIndex((row) => row.batchId === batchId) === index;
                    return (
                      <div key={entry.actionId} className="contents">
                        {startsBatch && entry.undo === "available" ? (
                          <li className="flex justify-end border-b py-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={undo.isPending}
                              onClick={() => undo.mutate({ batchId })}
                            >
                              {t("activity.undoAll")}
                            </Button>
                          </li>
                        ) : null}
                        <ActivityRow
                          entry={entry}
                          time={timeFormat.format(new Date(entry.at))}
                          busy={undo.isPending}
                          onUndo={() => undo.mutate({ actionId: entry.actionId })}
                        />
                      </div>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {list.hasNextPage && (
            <Button
              variant="ghost"
              className="self-start"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t("activity.more")}
            </Button>
          )}
        </div>
      )}
    </main>
  );
}
