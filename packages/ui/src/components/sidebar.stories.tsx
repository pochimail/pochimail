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
import type { Meta, StoryObj } from "@storybook/react-vite";
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
import { useState } from "react";

const ACCOUNTS = [
  { id: "gmail", label: "alex@example.test" },
  { id: "outlook", label: "alex@work.example.test" },
];
const TYPES = [
  ["Personal", UserIcon, 6820],
  ["Transactional", FileTextIcon, 7646],
  ["Alert emails", AtSignIcon, 14230],
  ["Newsletters", NewspaperIcon, 10410],
  ["Promotions", TagIcon, 9206],
] as const;

/** The whole frame in plain markup: only the width of the box around it decides rail, tabs or sidebar. */
function Frame({
  width,
  types = TYPES,
}: {
  width: number;
  types?: readonly (readonly [string, (typeof TYPES)[number][1], number])[];
}) {
  const [account, setAccount] = useState<string | null>(null);
  const current = ACCOUNTS.find((a) => a.id === account)?.label ?? "All accounts";
  return (
    <div style={{ width, height: 640 }} className="max-w-full overflow-hidden border border-border">
      <SidebarProvider>
        <SidebarLayout>
          <Sidebar>
            <SidebarHeader>
              <SidebarBrand>Pochimail</SidebarBrand>
              <AccountSwitcher>
                <AccountSwitcherTrigger aria-label={`Account: ${current}`}>
                  <UsersIcon aria-hidden="true" />
                  <AccountSwitcherLabel>{current}</AccountSwitcherLabel>
                  <ChevronDownIcon aria-hidden="true" className="@min-phone:@max-desktop:hidden" />
                </AccountSwitcherTrigger>
                <AccountSwitcherContent>
                  <DropdownMenuLabel>Account</DropdownMenuLabel>
                  <AccountSwitcherGroup
                    value={account ?? ALL_ACCOUNTS}
                    onValueChange={(next) => setAccount(next === ALL_ACCOUNTS ? null : next)}
                  >
                    <AccountSwitcherItem value={ALL_ACCOUNTS}>All accounts</AccountSwitcherItem>
                    {ACCOUNTS.map((a) => (
                      <AccountSwitcherItem key={a.id} value={a.id}>
                        {a.label}
                      </AccountSwitcherItem>
                    ))}
                  </AccountSwitcherGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <PlusIcon aria-hidden="true" />
                    Add another account
                  </DropdownMenuItem>
                </AccountSwitcherContent>
              </AccountSwitcher>
            </SidebarHeader>
            <SidebarContent aria-label="Main navigation">
              <SidebarGroup>
                <SidebarGroupLabel>Email</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton href="#overview" isActive tooltip="Overview">
                      <LayoutGridIcon />
                      <SidebarMenuLabel>Overview</SidebarMenuLabel>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {types.map(([label, Icon, count]) => (
                    <SidebarMenuItem key={label} reach="wide">
                      <SidebarMenuButton
                        href="#type"
                        tone="muted"
                        tooltip={label}
                        className={count === 0 ? "opacity-60" : undefined}
                      >
                        <Icon />
                        <SidebarMenuLabel>{label}</SidebarMenuLabel>
                        <SidebarMenuBadge>{count.toLocaleString("en")}</SidebarMenuBadge>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>Tools</SidebarGroupLabel>
                <SidebarMenu>
                  {(
                    [
                      ["Documents", PaperclipIcon],
                      ["Activity", Undo2Icon],
                      ["Settings", SettingsIcon],
                    ] as const
                  ).map(([label, Icon]) => (
                    <SidebarMenuItem key={label}>
                      <SidebarMenuButton href={`#${label}`} tooltip={label}>
                        <Icon />
                        <SidebarMenuLabel>{label}</SidebarMenuLabel>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tone="muted" tooltip="Teams">
                    <button type="button" disabled aria-disabled="true">
                      <UsersIcon />
                      <SidebarMenuLabel>Teams</SidebarMenuLabel>
                      <SidebarMenuBadge>Soon</SidebarMenuBadge>
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset>
            <main className="p-6">
              <h1 className="text-4xl">Overview</h1>
              <p className="mt-2 text-muted-foreground">
                Resize the story width to see the layout swap.
              </p>
            </main>
          </SidebarInset>
        </SidebarLayout>
      </SidebarProvider>
    </div>
  );
}

const meta = {
  title: "Components/Sidebar",
  component: Frame,
  parameters: { layout: "padded" },
  args: { width: 1100 },
} satisfies Meta<typeof Frame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullSidebar: Story = { args: { width: 1100 } };
/** 760-960: rail, content in a rounded panel. */
export const IconRail: Story = { args: { width: 860 } };
/** 560-760: rail, edge to edge (the desktop window minimum is 720). */
export const IconRailEdgeToEdge: Story = { args: { width: 720 } };
export const BottomTabs: Story = { args: { width: 420 } };
/** Empty types stay listed, muted, with a count of 0: here only Personal and Newsletters have mail. */
export const EmptyTypesMuted: Story = {
  args: {
    width: 1100,
    types: TYPES.map(([label, icon, count]) =>
      label === "Personal" || label === "Newsletters" ? [label, icon, count] : [label, icon, 0],
    ),
  },
};
export const Dark: Story = {
  args: { width: 1100 },
  decorators: [
    (Story) => (
      <div className="dark rounded-xl bg-background p-4 text-foreground">
        <Story />
      </div>
    ),
  ],
};
