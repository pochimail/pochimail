import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWorkerClient } from "../../lib/worker-context.tsx";

const REFRESH_EVERY_MS = 2000;

/** A category appears when it gets mail (D5): while an account scans, refresh the counts at most every 2 s. */
export function useRefreshCategoriesWhileScanning(accounts: readonly { id: string }[]) {
  const accountIds = accounts.map((a) => a.id);
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const key = accountIds.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable identity of `accountIds`.
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      last = Date.now();
      timer = undefined;
      void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    };
    const stops = accountIds.map((accountId) =>
      client.subscribe(
        "scan.progress",
        { accountId },
        () => {
          const wait = REFRESH_EVERY_MS - (Date.now() - last);
          if (wait <= 0) refresh();
          else timer ??= setTimeout(refresh, wait);
        },
        () => {},
      ),
    );
    return () => {
      for (const stop of stops) stop();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, queryClient, key]);
}
