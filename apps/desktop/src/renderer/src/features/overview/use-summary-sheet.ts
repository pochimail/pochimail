import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RpcClient } from "#shared/ipc/client.ts";
import type { InputOf, OutputOf } from "#shared/ipc/contract.ts";
import { type AppSettings, DEFAULT_APP_SETTINGS, type TidyCadence } from "#shared/settings.ts";
import { queryKeys } from "../../lib/query/keys.ts";

/** The Overview heading receives focus when a sheet opens without a trigger to return to. */
export const SUMMARY_FOCUS_TARGET_ID = "overview-summary-focus";

type SummaryPatch = Partial<Pick<AppSettings, "tidyCadence" | "summaryShown">>;

export type SummarySheetController = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly digest: OutputOf<"digest.get"> | undefined;
  readonly cadence: TidyCadence;
  readonly selectCadence: (cadence: TidyCadence) => void;
};

/** Owns the digest read, the once-only auto-open and the optimistic cadence/marker writes. */
export function useSummarySheet(
  client: RpcClient,
  queryClient: QueryClient,
  scope: InputOf<"digest.get">,
): SummarySheetController {
  const digest = useQuery({
    queryKey: queryKeys.digest(scope.accountId),
    queryFn: () => client.call("digest.get", scope),
  });
  // The same key as AppearanceProvider: one read, one cache, two independent choices in it.
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => client.call("settings.get"),
  });
  const [open, setOpenState] = useState(false);
  const openedAutomatically = useRef(false);

  const persist = useCallback(
    (patch: SummaryPatch) => {
      queryClient.setQueryData(queryKeys.settings(), (current: AppSettings | undefined) => ({
        ...(current ?? DEFAULT_APP_SETTINGS),
        ...patch,
      }));
      // The visible choice is already committed; a failed write must not snap it back.
      void client.call("settings.update", patch).catch(() => {});
    },
    [client, queryClient],
  );

  useEffect(() => {
    if (openedAutomatically.current || !settings.isSuccess || digest.data?.ready !== true) return;
    openedAutomatically.current = true;
    if (settings.data?.summaryShown ?? DEFAULT_APP_SETTINGS.summaryShown) return;
    setOpenState(true);
    persist({ summaryShown: true });
  }, [digest.data, persist, settings.data, settings.isSuccess]);

  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        // A reopen must show the newest digest, not the snapshot from the first scan.
        void queryClient.invalidateQueries({ queryKey: queryKeys.digest() });
      }
      setOpenState(next);
    },
    [queryClient],
  );

  const selectCadence = useCallback(
    (cadence: TidyCadence) => persist({ tidyCadence: cadence }),
    [persist],
  );

  return {
    open,
    setOpen,
    digest: digest.data,
    cadence: settings.data?.tidyCadence ?? DEFAULT_APP_SETTINGS.tidyCadence,
    selectCadence,
  };
}
