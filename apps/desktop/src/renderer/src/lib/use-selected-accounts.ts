import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { queryKeys } from "./query/keys.ts";
import { useWorkerClient } from "./worker-context.tsx";

/** The accounts and the switcher's selection (`?account=`): `accountIds` is the one account, or all of them. */
export function useSelectedAccounts() {
  const client = useWorkerClient();
  const { account } = useSearch({ strict: false });
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  const list = accounts.data ?? [];
  const selected = list.some((a) => a.id === account) ? (account ?? null) : null;
  const accountIds = selected === null ? list.map((a) => a.id) : [selected];
  return { accounts, list, selected, accountIds, loaded: accounts.isSuccess };
}
