import type { Category } from "@pochimail/classification/model/category";
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
  BellIcon,
  ChevronDownIcon,
  FileTextIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  NewspaperIcon,
  PaperclipIcon,
  PlusIcon,
  SettingsIcon,
  ShoppingBagIcon,
  TagIcon,
  Undo2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { type ComponentType, useEffect } from "react";
import { queryKeys } from "../../lib/query/keys.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { visibleCategories } from "./visible-categories.ts";

const CATEGORY_NAV: Record<Category, { label: MessageKey; icon: ComponentType }> = {
  people: { label: "category.people", icon: UserIcon },
  records: { label: "category.records", icon: FileTextIcon },
  "purchases-travel": { label: "category.purchasesTravel", icon: ShoppingBagIcon },
  "sign-ins-security": { label: "category.signInsSecurity", icon: KeyRoundIcon },
  notifications: { label: "category.notifications", icon: BellIcon },
  newsletters: { label: "category.newsletters", icon: NewspaperIcon },
  promotions: { label: "category.promotions", icon: TagIcon },
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

/** A category appears when it gets mail (D5): while an account scans, refresh the counts at most every 2 s. */
function useRefreshCategoriesWhileScanning(accounts: readonly { id: string }[]) {
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

/**
 * The frame of every screen after onboarding: sidebar, icon rail or bottom tabs by container width, with
 * the account switcher. The account selection lives in the router (`?account=`); counts follow it.
 */
export function AppFrame() {
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
  const selected = accountList.some((a) => a.id === account) ? (account ?? null) : null;
  const accountIds = selected === null ? accountList.map((a) => a.id) : [selected];

  const counts = useQuery({
    queryKey: queryKeys.categoryCounts(accountIds),
    queryFn: () => client.call("mailbox.categories", { accountIds }),
    enabled: accounts.isSuccess,
  });
  const categories = visibleCategories(counts.data);
  const currentLabel = accountList.find((a) => a.id === selected)?.displayName ?? t("switcher.all");
  const selectAccount = (next: string) =>
    void navigate({
      to: ".",
      search: (prev) => {
        const { account: _previous, ...rest } = prev;
        return next === ALL_ACCOUNTS ? rest : { ...rest, account: next };
      },
    });
  useRefreshCategoriesWhileScanning(accountList);

  return (
    <SidebarProvider>
      <SidebarLayout>
        <Sidebar>
          <SidebarHeader>
            <SidebarBrand>{t("nav.brand")}</SidebarBrand>
            <AccountSwitcher>
              <AccountSwitcherTrigger aria-label={`${t("switcher.menu")}: ${currentLabel}`}>
                <UsersIcon aria-hidden="true" />
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
                {categories.map(({ id, count }) => {
                  const nav = CATEGORY_NAV[id];
                  const Icon = nav.icon;
                  const target = `/category/${id}`;
                  return (
                    <SidebarMenuItem key={id} reach="wide">
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === target}
                        tone="muted"
                        tooltip={t(nav.label)}
                      >
                        <Link
                          to="/category/$categoryId"
                          params={{ categoryId: id }}
                          search={(prev) => prev}
                        >
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
