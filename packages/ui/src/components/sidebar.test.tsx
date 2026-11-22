import {
  AccountSwitcher,
  AccountSwitcherContent,
  AccountSwitcherGroup,
  AccountSwitcherItem,
  AccountSwitcherTrigger,
  ALL_ACCOUNTS,
} from "@pochimail/ui/components/account-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarLayout,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@pochimail/ui/components/sidebar";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Observed = { width: number; fire: () => void };
let observed: Observed[] = [];

beforeEach(() => {
  observed = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: (entries: unknown[]) => void) {}
      observe(target: Element) {
        // Radix (tooltip, menu) observes sizes too; only the sidebar provider's box is resized here.
        if (target.getAttribute("data-slot") !== "sidebar-provider") return;
        const record: Observed = {
          width: 1000,
          fire: () => this.callback([{ contentRect: { width: record.width } }]),
        };
        observed.push(record);
        record.fire();
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const resizeTo = (width: number) =>
  act(() => {
    for (const o of observed) {
      o.width = width;
      o.fire();
    }
  });

const Frame = () => (
  <SidebarProvider>
    <SidebarLayout>
      <Sidebar>
        <SidebarHeader>
          <button type="button">Switcher</button>
        </SidebarHeader>
        <SidebarContent aria-label="Main">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton href="#a" isActive tooltip="Alpha">
                Alpha
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton href="#b" tooltip="Beta">
                Beta
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <main>content</main>
      </SidebarInset>
    </SidebarLayout>
  </SidebarProvider>
);

it("steps full sidebar, rail, edge-to-edge rail, tabs at 960/760/560 without remounting content or reordering focus (guards a layout swap that remounts the page or scrambles tab order)", async () => {
  const { container } = render(<Frame />);
  const layout = () =>
    container.querySelector("[data-slot=sidebar-provider]")?.getAttribute("data-layout");
  const main = screen.getByRole("main");
  const links = screen.getAllByRole("link");
  const tabOrder = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await userEvent.tab();
      seen.push(document.activeElement?.textContent ?? "");
    }
    return seen;
  };
  const wide = await tabOrder();
  expect(layout()).toBe("full");
  const steps: [number, string][] = [
    [959, "rail"],
    [760, "rail"],
    [759, "compact"],
    [560, "compact"],
    [559, "tabs"],
    [960, "full"],
  ];
  for (const [width, expected] of steps) {
    resizeTo(width);
    expect(layout(), `${width}px`).toBe(expected);
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getAllByRole("link")).toEqual(links);
    expect(await tabOrder()).toEqual(wide);
  }
});

it("insets the content panel evenly above tablet width (guards a panel stuck to the sidebar)", () => {
  const { container } = render(<Frame />);
  const inset = container.querySelector("[data-slot=sidebar-inset]");
  expect(inset?.className).toContain("@min-tablet:m-2");
  expect(inset?.className).not.toContain("ms-0");
  expect(inset?.className).toContain("@min-tablet:rounded-2xl");
  expect(inset?.className).toContain("@max-phone:row-start-2");
  expect(inset?.className).toContain("overflow-y-auto");
});

it("sets aria-current only on the active item (guards a tab bar that cannot tell where you are)", () => {
  render(<Frame />);
  expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Beta" }).getAttribute("aria-current")).toBeNull();
});

it("shows the item name as a tooltip only in the rail (guards an icon-only rail with no visible name, and a redundant tooltip in the full sidebar)", async () => {
  render(<Frame />);
  await userEvent.hover(screen.getByRole("link", { name: "Beta" }));
  expect(screen.queryByRole("tooltip")).toBeNull();
  await userEvent.unhover(screen.getByRole("link", { name: "Beta" }));
  resizeTo(859);
  await userEvent.hover(screen.getByRole("link", { name: "Beta" }));
  expect((await screen.findByRole("tooltip")).textContent).toBe("Beta");
});

it("reports the account id and All accounts from the composed switcher (guards a switcher that cannot go back to all)", async () => {
  const onValueChange = vi.fn();
  render(
    <AccountSwitcher>
      <AccountSwitcherTrigger>Account</AccountSwitcherTrigger>
      <AccountSwitcherContent>
        <AccountSwitcherGroup value="a1" onValueChange={onValueChange}>
          <AccountSwitcherItem value={ALL_ACCOUNTS}>All accounts</AccountSwitcherItem>
          <AccountSwitcherItem value="a1">one@example.test</AccountSwitcherItem>
        </AccountSwitcherGroup>
      </AccountSwitcherContent>
    </AccountSwitcher>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Account" }));
  await userEvent.click(await screen.findByRole("menuitemradio", { name: "All accounts" }));
  expect(onValueChange).toHaveBeenCalledWith(ALL_ACCOUNTS);
});
