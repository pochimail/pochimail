/** Query keys for worker-backed data. Centralized so subscriptions can update the same caches without refetching. */
export const queryKeys = {
  appState: () => ["app", "state"] as const,
  accounts: () => ["accounts", "list"] as const,
  categoryCounts: (accountIds: readonly string[]) => ["mailbox", "categories", accountIds] as const,
  overview: (accountId?: string) => ["overview", accountId ?? "all"] as const,
  /** Without an account this is the prefix that invalidates every account's digest cache. */
  digest: (accountId?: string) =>
    accountId === undefined ? (["digest"] as const) : (["digest", accountId] as const),
  settings: () => ["settings"] as const,
  deviceName: () => ["device", "name"] as const,
  scanStatus: (accountIds: readonly string[]) => ["scan", "status", accountIds] as const,
  scanProgress: (accountId: string) => ["scan", "progress", accountId] as const,
};
