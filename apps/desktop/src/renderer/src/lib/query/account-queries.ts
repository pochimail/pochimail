import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys.ts";

const mentions = (key: readonly unknown[], accountId: string): boolean =>
  JSON.stringify(key).includes(JSON.stringify(accountId));

/** Everything the screens cache about accounts, mail figures and scans: refetched after an account goes away. */
const ACCOUNT_DEPENDENT = [
  queryKeys.accounts(),
  ["overview"],
  ["review"],
  ["mailbox"],
  ["scan"],
  queryKeys.digest(),
] as const;

/** A removed account's cached answers are dropped, and the lists and figures that included it are read again. */
export const dropAccountQueries = (queryClient: QueryClient, accountId: string): void => {
  queryClient.removeQueries({ predicate: (query) => mentions(query.queryKey, accountId) });
  for (const queryKey of ACCOUNT_DEPENDENT) void queryClient.invalidateQueries({ queryKey });
};
