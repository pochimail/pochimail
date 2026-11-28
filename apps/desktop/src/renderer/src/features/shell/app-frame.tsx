import type { EmailType } from "@pochimail/classification/model/email-type";
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
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import {
  AtSignIcon,
  ChevronDownIcon,
  FileTextIcon,
  LayoutGridIcon,
  NewspaperIcon,
  PaperclipIcon,
  PlusIcon,
  SettingsIcon,
  TagIcon,
  Undo2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { type ComponentType, useEffect } from "react";
import { isMacDesktop } from "../../lib/platform.ts";
import { ProviderIcon } from "../../lib/provider-icon.tsx";
import { queryKeys } from "../../lib/query/keys.ts";
import { TYPE_LABELS } from "../../lib/type-labels.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { SyncProgress } from "./sync-progress.tsx";
import { visibleTypes } from "./visible-types.ts";

const TYPE_NAV: Record<EmailType, { label: MessageKey; icon: ComponentType }> = {
  personal: { label: TYPE_LABELS.personal, icon: UserIcon },
  transactional: { label: TYPE_LABELS.transactional, icon: FileTextIcon },
  notification: { label: TYPE_LABELS.notification, icon: AtSignIcon },
  newsletter: { label: TYPE_LABELS.newsletter, icon: NewspaperIcon },
  promotion: { label: TYPE_LABELS.promotion, icon: TagIcon },
};

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

/** A type appears when it gets mail (D5): while an account scans, refresh the counts at most every 2 s. */
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
  const locale = useLocale();
  const client = useWorkerClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { account } = useSearch({ strict: false });
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  const accountList = accounts.data ?? [];
  const allAccountIds = accountList.map((a) => a.id);
  const selected = accountList.some((a) => a.id === account) ? (account ?? null) : null;
  const accountIds = selected === null ? allAccountIds : [selected];

  const counts = useQuery({
    queryKey: queryKeys.typeCounts(accountIds),
    queryFn: () => client.call("mailbox.types", { accountIds }),
    enabled: accounts.isSuccess,
  });
  const types = visibleTypes(counts.data);
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
                {types.map(({ id, count }) => {
                  const nav = TYPE_NAV[id];
                  const Icon = nav.icon;
                  const target = `/type/${id}`;
                  return (
                    <SidebarMenuItem key={id} reach="wide">
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === target}
                        tone="muted"
                        tooltip={t(nav.label)}
                      >
                        <Link to="/type/$typeId" params={{ typeId: id }} search={(prev) => prev}>
                          <Icon />
                          <SidebarMenuLabel>{t(nav.label)}</SidebarMenuLabel>
                          <SidebarMenuBadge>{count.toLocaleString(locale)}</SidebarMenuBadge>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
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
