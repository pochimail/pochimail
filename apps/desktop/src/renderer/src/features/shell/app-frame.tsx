import {
  AccountSwitcher,
  AccountSwitcherContent,
  AccountSwitcherGroup,
  AccountSwitcherItem,
  AccountSwitcherLabel,
  AccountSwitcherTrigger,
  ALL_ACCOUNTS,
} from "@pochimail/ui/components/account-switcher";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@pochimail/ui/components/dropdown-menu";
import { Mascot, type MascotPose } from "@pochimail/ui/components/mascot";
import {
  Sidebar,
  SidebarBrand,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarLayout,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuLabel,
  SidebarProvider,
} from "@pochimail/ui/components/sidebar";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LayoutGridIcon,
  PaperclipIcon,
  PlusIcon,
  SettingsIcon,
  Undo2Icon,
  UsersIcon,
} from "lucide-react";
import { type ComponentType, useEffect } from "react";
import { isMacDesktop } from "../../lib/platform.ts";
import { ProviderIcon } from "../../lib/provider-icon.tsx";
import { queryKeys } from "../../lib/query/keys.ts";
import { useSelectedAccounts } from "../../lib/use-selected-accounts.ts";
import { useTopics } from "../../lib/use-topics.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { TopicsGroup, TypeItems } from "./mail-nav.tsx";
import { SyncProgress } from "./sync-progress.tsx";

type NavTarget = "/overview" | "/documents" | "/activity" | "/settings";

function NavItem({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: NavTarget;
  label: string;
  icon: ComponentType;
  /** The current pathname. */
  active: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active === to} tooltip={label}>
        <Link to={to} search={(prev) => prev}>
          <Icon />
          <SidebarMenuLabel>{label}</SidebarMenuLabel>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const REFRESH_EVERY_MS = 2000;

/** A section's count follows the mail it gets: while an account scans, refresh the counts at most every 2 s. */
function useRefreshCountsWhileScanning(accounts: readonly { id: string }[]) {
  const accountIds = accounts.map((a) => a.id);
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const key = accountIds.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable identity of `accountIds`.
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      last = Date.now();
      timer = undefined;
      void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    };
    const stops = accountIds.map((accountId) =>
      client.subscribe(
        "scan.progress",
        { accountId },
        () => {
          const wait = REFRESH_EVERY_MS - (Date.now() - last);
          if (wait <= 0) refresh();
          else timer ??= setTimeout(refresh, wait);
        },
        () => {},
      ),
    );
    return () => {
      for (const stop of stops) stop();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, queryClient, key]);
}

/** The signed-in shell: sidebar/tabs, account switcher (`?account=`) and counts. */
export function AppFrame({ pose }: { readonly pose: MascotPose }) {
  const t = useT();
  const _locale = useLocale();
  const client = useWorkerClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { list: accountList, selected, accountIds, loaded } = useSelectedAccounts();
  const allAccountIds = accountList.map((a) => a.id);

  const counts = useQuery({
    queryKey: queryKeys.typeCounts(accountIds),
    queryFn: () => client.call("mailbox.types", { accountIds }),
    enabled: loaded,
  });
  const topics = useTopics(accountIds, loaded).data ?? [];
  const current = accountList.find((a) => a.id === selected);
  const currentLabel = current?.displayName ?? t("switcher.all");
  const selectAccount = (next: string) =>
    void navigate({
      to: ".",
      search: (prev) => {
        const { account: _previous, ...rest } = prev;
        return next === ALL_ACCOUNTS ? rest : { ...rest, account: next };
      },
    });
  useRefreshCountsWhileScanning(accountList);

  const onMac = isMacDesktop();

  return (
    <SidebarProvider>
      <SyncProgress accountIds={allAccountIds} />
      <SidebarLayout>
        <Sidebar>
          <SidebarHeader
            className={
              onMac
                ? "pt-12 [-webkit-app-region:drag] [app-region:drag] [&_a]:[-webkit-app-region:no-drag] [&_a]:[app-region:no-drag] [&_button]:[-webkit-app-region:no-drag] [&_button]:[app-region:no-drag]"
                : undefined
            }
          >
            <SidebarBrand className="flex items-center gap-2">
              <Mascot pose={pose} size="xs" className="w-8" data-hover-pochi="" />
              {t("nav.brand")}
            </SidebarBrand>
            <AccountSwitcher>
              <AccountSwitcherTrigger aria-label={`${t("switcher.menu")}: ${currentLabel}`}>
                {current ? <ProviderIcon provider={current.provider} /> : <UsersIcon aria-hidden />}
                <AccountSwitcherLabel>{currentLabel}</AccountSwitcherLabel>
                <ChevronDownIcon aria-hidden="true" className="@min-phone:@max-desktop:hidden" />
              </AccountSwitcherTrigger>
              <AccountSwitcherContent>
                <DropdownMenuLabel>{t("switcher.menu")}</DropdownMenuLabel>
                <AccountSwitcherGroup
                  value={selected ?? ALL_ACCOUNTS}
                  onValueChange={selectAccount}
                >
                  <AccountSwitcherItem value={ALL_ACCOUNTS}>
                    {t("switcher.all")}
                  </AccountSwitcherItem>
                  {accountList.map((a) => (
                    <AccountSwitcherItem key={a.id} value={a.id}>
                      <ProviderIcon provider={a.provider} />
                      {a.displayName}
                    </AccountSwitcherItem>
                  ))}
                </AccountSwitcherGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void navigate({ to: "/connect" })}>
                  <PlusIcon aria-hidden="true" />
                  {t("switcher.add")}
                </DropdownMenuItem>
              </AccountSwitcherContent>
            </AccountSwitcher>
          </SidebarHeader>
          <SidebarContent aria-label={t("nav.label")}>
            <SidebarGroup>
              <SidebarGroupLabel>{t("nav.email")}</SidebarGroupLabel>
              <SidebarMenu>
                <NavItem
                  to="/overview"
                  label={t("overview.title")}
                  icon={LayoutGridIcon}
                  active={pathname}
                />
                <TypeItems counts={counts.data} pathname={pathname} />
              </SidebarMenu>
            </SidebarGroup>
            <TopicsGroup topics={topics} pathname={pathname} />
            <SidebarGroup>
              <SidebarGroupLabel>{t("nav.tools")}</SidebarGroupLabel>
              <SidebarMenu>
                <NavItem
                  to="/documents"
                  label={t("documents.title")}
                  icon={PaperclipIcon}
                  active={pathname}
                />
                <NavItem
                  to="/activity"
                  label={t("activity.title")}
                  icon={Undo2Icon}
                  active={pathname}
                />
                <NavItem
                  to="/settings"
                  label={t("settings.title")}
                  icon={SettingsIcon}
                  active={pathname}
                />
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tone="muted" tooltip={t("nav.teams")}>
                  <button type="button" disabled aria-disabled="true">
                    <UsersIcon />
                    <SidebarMenuLabel>{t("nav.teams")}</SidebarMenuLabel>
                    <SidebarMenuBadge>{t("nav.soon")}</SidebarMenuBadge>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <Outlet />
        </SidebarInset>
      </SidebarLayout>
    </SidebarProvider>
  );
}
