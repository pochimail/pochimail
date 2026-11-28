import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useSearch } from "@tanstack/react-router";
import { useNeedsReauth, useReconnect } from "../../lib/needs-reauth.tsx";
import { queryKeys } from "../../lib/query/keys.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { NeedsReconnectState } from "./required-states.tsx";

/**
 * Stands in for a screen whose every account (the one selected, or all of them) lost access: there is
 * nothing to show but the way back. While another account in the selection still syncs, its screen stays.
 */
export function ReconnectGate() {
  const client = useWorkerClient();
  const navigate = useNavigate();
  const reconnect = useReconnect();
  const needsReauth = useNeedsReauth();
  const { account } = useSearch({ strict: false });
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  const shown = (accounts.data ?? []).filter(
    (item) => account === undefined || item.id === account,
  );
  const lost = shown.map((item) => needsReauth.find((entry) => entry.accountId === item.id));
  const first = lost.every((entry) => entry !== undefined) ? lost[0] : undefined;
  return first === undefined ? (
    <Outlet />
  ) : (
    <NeedsReconnectState
      provider={first.provider}
      onAction={() => void reconnect(first.accountId)}
      onSecondary={() => void navigate({ to: "/settings", search: (prev) => prev })}
    />
  );
}
