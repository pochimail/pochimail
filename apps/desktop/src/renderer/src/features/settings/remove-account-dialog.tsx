import { Button } from "@pochimail/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pochimail/ui/components/dialog";
import { toast } from "@pochimail/ui/components/sonner";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { dropAccountQueries } from "../../lib/query/account-queries.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";

/**
 * Says what removing does before it happens: access revoked at the provider, Pochimail's data for the account
 * deleted, the mailbox and saved documents untouched. When the provider could not be told, it says so afterwards.
 */
export function RemoveAccountDialog({
  account,
  provider,
  onClose,
}: {
  account: { readonly id: string; readonly displayName: string };
  /** The provider's name as the person knows it, already translated. */
  provider: string;
  onClose: () => void;
}) {
  const client = useWorkerClient();
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async () => {
    setBusy(true);
    setFailed(false);
    const outcome = await client
      .call("accounts.remove", { accountId: account.id })
      .catch(() => ({ status: "failed" }) as const);
    setBusy(false);
    if (outcome.status === "failed") {
      setFailed(true);
      return;
    }
    dropAccountQueries(queryClient, account.id);
    const address = account.displayName;
    toast(
      outcome.remoteRevoked
        ? t("accounts.removed", { address })
        : t("accounts.removed.notRevoked", { address, provider }),
    );
    onClose();
    const remaining = await queryClient.fetchQuery({
      queryKey: queryKeys.accounts(),
      queryFn: () => client.call("accounts.list"),
      staleTime: 0,
    });
    if (remaining.length === 0) await navigate({ to: "/welcome" });
  };

  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("accounts.remove.title", { address: account.displayName })}</DialogTitle>
          <DialogDescription>{t("accounts.remove.body", { provider })}</DialogDescription>
        </DialogHeader>
        {failed ? <p role="alert">{t("accounts.remove.failed")}</p> : null}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("accounts.remove.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {t("accounts.remove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
