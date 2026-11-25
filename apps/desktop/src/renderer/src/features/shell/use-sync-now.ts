import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { OutputOf } from "#shared/ipc/contract.ts";
import type { SyncResultView } from "#shared/ipc/sync-contract.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { useScanStatus } from "../../lib/scan-status.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";

/** What the person has to hear about an account's last sync; the results that went well are not here. */
export type SyncProblem =
  | { readonly accountId: string; readonly kind: "offline" }
  | { readonly accountId: string; readonly kind: "auth-expired" }
  | { readonly accountId: string; readonly kind: "rate-limited"; readonly resumeAt: number }
  | { readonly accountId: string; readonly kind: "failed" };

const problemOf = (
  accountId: string,
  result: SyncResultView,
  now: number,
): SyncProblem | undefined => {
  if (result.status === "offline") return { accountId, kind: "offline" };
  if (result.status === "needs-reauth") return { accountId, kind: "auth-expired" };
  if (result.status === "failed") return { accountId, kind: "failed" };
  if (result.status === "rate-limited" && result.resumeAt > now)
    return { accountId, kind: "rate-limited", resumeAt: result.resumeAt };
  return undefined;
};

type SyncStatus = OutputOf<"sync.status">;

/**
 * Manual sync for the accounts the shell shows: `selected` is the one account chosen, or `null` for All accounts.
 * It is running while the worker says so (a poll or a click, after a reload too) or while a first scan is
 * running, and it reports what went wrong with the last sync of each account.
 */
export function useSyncNow(accountIds: readonly string[], selected: string | null) {
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const scan = useScanStatus(accountIds);
  const [pending, setPending] = useState(false);
  const [callFailed, setCallFailed] = useState(false);
  const status = useQuery({
    queryKey: queryKeys.syncStatus(accountIds),
    queryFn: () => client.call("sync.status", { accountIds: [...accountIds] }),
    enabled: accountIds.length > 0,
  });
  const entries: SyncStatus = status.data ?? [];

  const syncNow = () => {
    if (pending) return;
    setPending(true);
    setCallFailed(false);
    client
      .call("sync.now", selected === null ? {} : { accountId: selected })
      .catch(() => setCallFailed(true))
      .finally(() => {
        setPending(false);
        for (const key of ["sync", "mailbox", "overview"])
          void queryClient.invalidateQueries({ queryKey: [key] });
      });
  };

  const now = Date.now();
  return {
    running: pending || scan.active || entries.some((entry) => entry.running),
    callFailed,
    problems: entries.flatMap((entry) =>
      entry.running || entry.last === null
        ? []
        : (problemOf(entry.accountId, entry.last.result, now) ?? []),
    ),
    syncNow,
  };
}
