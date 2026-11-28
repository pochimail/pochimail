import { Button } from "@pochimail/ui/components/button";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { OutputOf } from "#shared/ipc/contract.ts";
import { useNeedsReauth, useReconnect } from "../../lib/needs-reauth.tsx";
import { ProviderIcon } from "../../lib/provider-icon.tsx";
import { queryKeys } from "../../lib/query/keys.ts";
import { SETTINGS_ROW } from "../../lib/settings-row.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { RemoveAccountDialog } from "./remove-account-dialog.tsx";
import { SettingsSection } from "./settings-section.tsx";

type SettingsAccount = OutputOf<"accounts.list">[number];

const PROVIDER_LABELS: Record<SettingsAccount["provider"], MessageKey> = {
  google: "accounts.provider.google",
  microsoft: "accounts.provider.microsoft",
};

function AccountRow({ account }: { account: SettingsAccount }) {
  const t = useT();
  const reconnect = useReconnect();
  const lost = useNeedsReauth().some((entry) => entry.accountId === account.id);
  const [confirming, setConfirming] = useState(false);
  const provider = t(PROVIDER_LABELS[account.provider]);
  return (
    <li className={SETTINGS_ROW}>
      <span aria-hidden="true" className="flex size-6.5 shrink-0 items-center justify-center">
        <ProviderIcon provider={account.provider} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium">{account.displayName}</span>
        <span className={lost ? "text-ui text-foreground" : "text-ui text-muted-foreground"}>
          {lost ? t("accounts.needsReauth", { provider }) : provider}
        </span>
      </span>
      {lost ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`${t("accounts.reconnect")}: ${account.displayName}`}
          onClick={() => void reconnect(account.id)}
        >
          {t("accounts.reconnect")}
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        aria-label={`${t("accounts.remove")}: ${account.displayName}`}
        onClick={() => setConfirming(true)}
      >
        {t("accounts.remove")}
      </Button>
      {confirming ? (
        <RemoveAccountDialog
          account={account}
          provider={provider}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </li>
  );
}

/** Settings › Accounts: one row per connected account, with Reconnect when it lost access and Remove. */
export function AccountsSection() {
  const client = useWorkerClient();
  const t = useT();
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  const list = accounts.data ?? [];
  return list.length === 0 ? null : (
    <SettingsSection id="settings-accounts" title={t("settings.accounts")}>
      {list.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
    </SettingsSection>
  );
}
