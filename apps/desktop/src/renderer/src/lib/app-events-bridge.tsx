import { toast } from "@pochimail/ui/components/sonner";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { RpcClient } from "#shared/ipc/client.ts";
import { recordAccountEvent } from "./needs-reauth.tsx";
import { useOptimisticRegistry } from "./optimistic-context.tsx";
import { dropAccountQueries } from "./query/account-queries.ts";
import { queryKeys } from "./query/keys.ts";
import { subscribeAppEvents } from "./query/worker-events.ts";

/** Keeps the global app.events subscription active so optimistic mutations reconcile without polling. */
export function AppEventsBridge({ client }: { client: RpcClient }) {
  const t = useT();
  const registry = useOptimisticRegistry();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeAppEvents(
        client,
        registry,
        () => toast.error(t("scan.failed")),
        () => {
          void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
          void queryClient.invalidateQueries({ queryKey: ["overview"] });
        },
        () => void queryClient.invalidateQueries({ queryKey: ["scan", "status"] }),
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.digest() }),
        (event) => {
          recordAccountEvent(queryClient, event);
          if (event.type === "AccountRemoved") dropAccountQueries(queryClient, event.accountId);
        },
      ),
    [client, registry, queryClient, t],
  );
  return null;
}
