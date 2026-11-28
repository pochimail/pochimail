import { toast } from "@pochimail/ui/components/sonner";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RpcClient } from "#shared/ipc/client.ts";
import {
  noRequiredStates,
  reduceRequiredStates,
} from "../features/states/required-state-reducer.ts";
import { queryKeys } from "./query/keys.ts";
import type { AccountEvent } from "./query/worker-events.ts";
import { useWorkerClient } from "./worker-context.tsx";

type NeedsReauthAccounts = typeof noRequiredStates.needsReauth;
/** Keeps the accounts that lost access in the query cache, from `NeedsReauth` until `Reconnected` or removal. */
export const recordAccountEvent = (queryClient: QueryClient, event: AccountEvent): void => {
  queryClient.setQueryData<NeedsReauthAccounts>(
    queryKeys.needsReauth(),
    (current = []) =>
      reduceRequiredStates({ ...noRequiredStates, needsReauth: current }, event).needsReauth,
  );
};

const needsReauthQuery = (client: RpcClient) => ({
  queryKey: queryKeys.needsReauth(),
  queryFn: async (): Promise<NeedsReauthAccounts> => (await client.call("app.state")).needsReauth,
  // The worker's events keep it current after this first read.
  staleTime: Number.POSITIVE_INFINITY,
});

/** Seeds the cache with what the worker already knows, so a reloaded screen still shows the Reconnect gate. */
export const seedNeedsReauth = (queryClient: QueryClient, client: RpcClient): Promise<void> =>
  queryClient.prefetchQuery(needsReauthQuery(client));

export const useNeedsReauth = (): NeedsReauthAccounts =>
  useQuery(needsReauthQuery(useWorkerClient())).data ?? noRequiredStates.needsReauth;

/** Runs the consent again for one account; the screen then follows `Reconnected`, and only a failure is said aloud. */
export function useReconnect(): (accountId: string) => Promise<void> {
  const client = useWorkerClient();
  const t = useT();
  return useCallback(
    async (accountId) => {
      const outcome = await client
        .call("accounts.reconnect", { accountId })
        .catch(() => ({ status: "failed", reason: "unknown" }) as const);
      if (outcome.status !== "failed") return;
      toast.error(
        t(outcome.reason === "wrong-account" ? "reconnect.wrongAccount" : "reconnect.failed"),
      );
    },
    [client, t],
  );
}
