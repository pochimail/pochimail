import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { queryKeys } from "./query/keys.ts";
import type { ScanJob, ScanProgressEvent } from "./scan-status-types.ts";
import { useWorkerClient } from "./worker-context.tsx";

/** At most one figure refresh per interval while events stream in; between refreshes the old figures stay on screen. */
const REFRESH_EVERY_MS = 1000;

type ScanState = {
  readonly jobs: readonly ScanJob[];
  readonly progress: Readonly<Record<string, ScanProgressEvent>>;
};

const ScanStateContext = createContext<ScanState | undefined>(undefined);

export type ScanStatus = {
  /** Whether the worker has a running or paused scan for these accounts. */
  readonly active: boolean;
  /** Read from the worker's jobs, so it survives leaving the screen and reloads. */
  readonly paused: boolean;
  /** 0 to 100; 0 while no total is known. */
  readonly percent: number;
  readonly processed: number;
  /** `null` while any account cannot say how many emails it has. */
  readonly total: number | null;
  pause(): void;
  resume(): void;
};

/**
 * One owner of the worker's live scan state for the whole shell. It reads `scan.status`, listens to `scan.progress`
 * once per account, and derives every screen's status from that shared state.
 */
export function ScanStatusProvider({ children }: { children: ReactNode }) {
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<Record<string, ScanProgressEvent>>({});
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  const accountIds = accounts.data?.map((a) => a.id) ?? [];
  const key = accountIds.join("\u0000");
  const jobs = useQuery({
    queryKey: queryKeys.scanStatus(accountIds),
    queryFn: () => client.call("scan.status", { accountIds: [...accountIds] }),
    enabled: accountIds.length > 0,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable identity of `accountIds`.
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer !== undefined) clearTimeout(timer);
      last = Date.now();
      timer = undefined;
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["scan", "status"] });
    };
    const stops = accountIds.map((accountId) =>
      client.subscribe(
        "scan.progress",
        { accountId },
        (event) => {
          if (event.phase === "done") {
            setProgress((all) => {
              const next = { ...all };
              delete next[accountId];
              return next;
            });
            refresh();
            return;
          }
          setProgress((all) => ({ ...all, [accountId]: event }));
          const wait = REFRESH_EVERY_MS - (Date.now() - last);
          if (wait <= 0) refresh();
          else timer ??= setTimeout(refresh, wait);
        },
        () => {},
      ),
    );
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const stop of stops) stop();
      setProgress({});
    };
  }, [client, queryClient, key]);

  const value = useMemo<ScanState>(
    () => ({ jobs: jobs.data ?? [], progress }),
    [jobs.data, progress],
  );
  return <ScanStateContext.Provider value={value}>{children}</ScanStateContext.Provider>;
}

/**
 * The live scan state of the given accounts, derived from the shell's single subscription set. Pause and resume
 * still act through the worker, on the live jobs of these accounts only.
 */
export function useScanStatus(accountIds: readonly string[]): ScanStatus {
  const state = useContext(ScanStateContext);
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  if (state === undefined) throw new Error("useScanStatus requires ScanStatusProvider");

  const live = state.jobs.filter((job) => accountIds.includes(job.accountId));
  const events = Object.values(state.progress).filter((event) =>
    live.some((job) => job.accountId === event.accountId),
  );
  const processed =
    events.reduce((sum, event) => sum + event.processed, 0) +
    live
      .filter((job) => !events.some((event) => event.accountId === job.accountId))
      .reduce((sum, job) => sum + job.processed, 0);
  const known = events.length === live.length && events.every((event) => event.total !== null);
  const total =
    known && live.length > 0 ? events.reduce((sum, event) => sum + (event.total ?? 0), 0) : null;
  const percent = total === null || total === 0 ? 0 : Math.min(100, (processed / total) * 100);

  const act = (status: "running" | "paused", call: "scan.pause" | "scan.resume") => {
    void Promise.all(
      live
        .filter((job) => job.status === status)
        .map((job) => client.call(call, { jobId: job.jobId })),
    ).finally(() => void queryClient.invalidateQueries({ queryKey: ["scan", "status"] }));
  };

  return {
    active: live.length > 0,
    paused: live.some((job) => job.status === "paused"),
    percent,
    processed,
    total,
    pause: () => act("running", "scan.pause"),
    resume: () => act("paused", "scan.resume"),
  };
}
