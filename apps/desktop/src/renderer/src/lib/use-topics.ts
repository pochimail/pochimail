import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./query/keys.ts";
import { useWorkerClient } from "./worker-context.tsx";

/** The topics that hold email for the given accounts (ADR 0016: only non-empty ones are shown), by name. */
export function useTopics(accountIds: readonly string[], enabled: boolean) {
  const client = useWorkerClient();
  return useQuery({
    queryKey: queryKeys.topicCounts(accountIds),
    queryFn: () => client.call("mailbox.topics", { accountIds: [...accountIds] }),
    enabled,
  });
}
