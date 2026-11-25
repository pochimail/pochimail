import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuLabel,
} from "@pochimail/ui/components/sidebar";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { RefreshCwIcon } from "lucide-react";
import { type SyncProblem, useSyncNow } from "./use-sync-now.ts";

interface Props {
  readonly accounts: readonly { readonly id: string; readonly displayName: string }[];
  /** The account chosen in the switcher, or `null` for All accounts. */
  readonly selected: string | null;
  readonly onReconnect: () => void;
}

/** "Sync now" for the selected account or All accounts, with the plain-words result of the last sync under it. */
export function SyncNow({ accounts, selected, onReconnect }: Props) {
  const t = useT();
  const locale = useLocale();
  const ids = (selected === null ? accounts : accounts.filter((a) => a.id === selected)).map(
    (a) => a.id,
  );
  const { running, problems, callFailed, syncNow } = useSyncNow(ids, selected);
  const nameOf = (accountId: string) => accounts.find((a) => a.id === accountId)?.displayName ?? "";

  const lines = (problem: SyncProblem) => {
    const account = nameOf(problem.accountId);
    switch (problem.kind) {
      case "offline":
        return t("sync.offline");
      case "auth-expired":
        return t("sync.authExpired", { account });
      case "rate-limited":
        return t("sync.rateLimited", {
          account,
          time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(problem.resumeAt),
        });
      case "failed":
        return t("sync.failed", { account });
    }
  };
  // One offline line however many accounts are affected.
  const shown = problems.filter(
    (problem, index) =>
      problem.kind !== "offline" || problems.findIndex((p) => p.kind === "offline") === index,
  );

  return (
    <div data-slot="sync-now" className="flex flex-col gap-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            tone="muted"
            tooltip={running ? t("sync.running") : t("sync.now")}
          >
            <button type="button" disabled={running} aria-busy={running} onClick={syncNow}>
              <RefreshCwIcon className={running ? "motion-safe:animate-spin" : undefined} />
              <SidebarMenuLabel>{running ? t("sync.running") : t("sync.now")}</SidebarMenuLabel>
            </button>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {callFailed || shown.length > 0 ? (
        <div
          role="status"
          data-slot="sync-status"
          className="flex flex-col gap-1 px-2 text-xs text-muted-foreground @min-phone:@max-desktop:hidden"
        >
          {callFailed ? <p>{t("sync.failedGeneric")}</p> : null}
          {shown.map((problem) => (
            <p key={`${problem.accountId}:${problem.kind}`}>
              {lines(problem)}
              {problem.kind === "auth-expired" ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={onReconnect}
                  >
                    {t("sync.reconnect")}
                  </button>
                </>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
