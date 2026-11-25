// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Counts = OutputOf<"mailbox.types">;
const zero: Counts = {
  personal: 0,
  transactional: 0,
  notification: 0,
  newsletter: 0,
  promotion: 0,
};
const mailboxes: Record<string, Counts> = {
  a1: { ...zero, personal: 10, newsletter: 5 },
  a2: { ...zero, personal: 2, transactional: 3 },
};

const setup = (initialPath = "/overview", theme: "system" | "light" | "dark" = "system") => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const state = {
    mailboxes: structuredClone(mailboxes),
    emit: (_e: EventOf<"app.events">) => {},
    emitters: [] as ((event: EventOf<"scan.progress">) => void)[],
    progress: (event: EventOf<"scan.progress">) => {
      for (const emit of state.emitters) emit(event);
    },
  };
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true, needsReauth: [] }),
      "device.name": () => "device" as const,
      "accounts.list": () => [
        { id: "a1", provider: "google" as const, displayName: "ann@example.test" },
        { id: "a2", provider: "microsoft" as const, displayName: "ann@work.example.test" },
      ],
      "mailbox.types": ({ accountIds }) => {
        const sum: Counts = { ...zero };
        for (const id of accountIds)
          for (const [key, n] of Object.entries(state.mailboxes[id] ?? zero))
            sum[key as keyof Counts] += n;
        return sum;
      },
      "overview.get": () => ({
        scanned: 0,
        toReview: 0,
        waiting: 0,
        deadlines: 0,
        important: 0,
        oldestWaitingDays: 0,
        cleanable: [],
        figures: {
          archived: 0,
          savedCount: 0,
          savedSize: 0,
          deletableSize: 0,
          unsubscribed: 0,
          totalSize: 0,
        },
      }),
      "scan.status": () => [],
      "digest.get": () => ({ ready: false, itemCount: 0, archived: 0, saved: 0, unsubscribed: 0 }),
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
        theme,
      }),
    },
    subscriptions: {
      "app.events": (_input, emit) => {
        state.emit = emit;
        return undefined;
      },
      "scan.progress": (_input, emit) => {
        state.emitters.push(emit);
        return () => {
          state.emitters = state.emitters.filter((current) => current !== emit);
        };
      },
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [initialPath] },
  );
  render(<App workerClient={client} router={router} />);
  return state;
};

const sidebar = async () =>
  within(await screen.findByRole("navigation", { name: "Main navigation" }));

const brandMascot = async () =>
  (await screen.findByText("Pochimail")).parentElement?.querySelector('[data-slot="mascot"]');

describe("Pochi in the signed-in shell", () => {
  it("keeps one small, hoverable Pochi beside the brand (guards losing Pochi after Setup)", async () => {
    setup();
    const mascot = await brandMascot();
    expect(mascot).not.toBeNull();
    expect(mascot?.className).toContain("w-8");
    expect(mascot?.hasAttribute("data-hover-pochi")).toBe(true);
  });

  it("uses the night pose in dark mode (guards a theme-blind mascot)", async () => {
    setup("/overview", "dark");
    const mascot = await brandMascot();
    await waitFor(() => expect(mascot?.getAttribute("data-pose")).toBe("night"));
  });

  // Guards: System-dark users getting the cream pose because the pose read the preference, not the resolved theme.
  it("uses the night pose when System resolves to the OS dark appearance", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    setup("/overview", "system");
    const mascot = await brandMascot();
    await waitFor(() => expect(mascot?.getAttribute("data-pose")).toBe("night"));
  });

  it("uses the reading pose on Documents (guards a context-blind mascot)", async () => {
    setup("/documents");
    const mascot = await brandMascot();
    expect(mascot?.getAttribute("data-pose")).toBe("reading");
  });
});

const slotClasses = (name: string): string[] => [
  ...(document.querySelector(`[data-slot="${name}"]`)?.classList ?? []),
];

const withViewportHeight = (height: number) => {
  const original = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  return () =>
    Object.defineProperty(window, "innerHeight", { configurable: true, value: original });
};

describe("app frame", () => {
  it.each([560, 760])(
    "keeps the shell inside a %ipx viewport (guards a clipped screen and sidebar)",
    async (height) => {
      // Guards: a shell with no definite viewport height, so the main screen or sidebar footer is cut off.
      const restoreHeight = withViewportHeight(height);
      try {
        setup();
        await sidebar();
        // jsdom has no layout engine: the guard is the class chain that bounds both scroll containers.
        expect(slotClasses("app-viewport")).toEqual(
          expect.arrayContaining(["h-dvh", "min-h-0", "w-full"]),
        );
        expect(slotClasses("sidebar-provider")).toEqual(
          expect.arrayContaining(["h-full", "min-h-0"]),
        );
        expect(slotClasses("sidebar-layout")).toEqual(
          expect.arrayContaining(["h-full", "min-h-0"]),
        );
        expect(slotClasses("sidebar-content")).toEqual(
          expect.arrayContaining(["min-h-0", "overflow-y-auto"]),
        );
        expect(slotClasses("sidebar-inset")).toEqual(
          expect.arrayContaining(["min-h-0", "overflow-y-auto"]),
        );
      } finally {
        restoreHeight();
      }
    },
  );

  it("hides a type with no email and shows it once it gets mail (guards D5: empty types listed)", async () => {
    const state = setup();
    const nav = await sidebar();
    await waitFor(() => expect(nav.getByRole("link", { name: /Personal/ })).toBeTruthy());
    expect(nav.queryByRole("link", { name: /Promotions/ })).toBeNull();
    expect(nav.queryByRole("link", { name: /Alert emails/ })).toBeNull();

    state.mailboxes.a1 = { ...zero, personal: 10, newsletter: 5, promotion: 4 };
    state.emit({ type: "ScanCompleted", accountId: "a1", processed: 4 });
    expect(await nav.findByRole("link", { name: /Promotions/ })).toBeTruthy();
  });

  it("changes the counts when switching account, without remounting the content (guards a reload on switch)", async () => {
    setup();
    const nav = await sidebar();
    const main = await screen.findByRole("main");
    await waitFor(() =>
      expect(nav.getByRole("link", { name: /Personal/ }).textContent).toContain("12"),
    );

    await userEvent.click(screen.getByRole("button", { name: /Account: All accounts/ }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "ann@work.example.test" }),
    );

    await waitFor(() =>
      expect(nav.getByRole("link", { name: /Personal/ }).textContent).toContain("2"),
    );
    expect(nav.queryByRole("link", { name: /Newsletters/ })).toBeNull();
    expect(nav.getByRole("link", { name: /Transactional/ }).textContent).toContain("3");
    expect(screen.getByRole("main")).toBe(main);
  });

  it("shows each account's provider icon beside its email, leaving All accounts unchanged (guards missing source marks)", async () => {
    setup();
    await sidebar();
    await userEvent.click(screen.getByRole("button", { name: /Account: All accounts/ }));

    const google = await screen.findByRole("menuitemradio", { name: "ann@example.test" });
    const microsoft = await screen.findByRole("menuitemradio", { name: "ann@work.example.test" });
    expect(
      google.querySelector('[data-slot="provider-icon"][data-provider="google"]'),
    ).not.toBeNull();
    expect(
      microsoft.querySelector('[data-slot="provider-icon"][data-provider="microsoft"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("menuitemradio", { name: "All accounts" })
        .querySelector("[data-slot=provider-icon]"),
    ).toBeNull();
  });

  it("shows the selected account's provider logo in the trigger and the users icon for All accounts (guards a trigger that ignores the account)", async () => {
    setup();
    await sidebar();
    const trigger = () => screen.getByRole("button", { name: /^Account: / });
    expect(trigger().querySelector("[data-slot=provider-icon]")).toBeNull();

    await userEvent.click(trigger());
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "ann@work.example.test" }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Account: ann@work.example.test" })
          .querySelector(
            '[data-slot="provider-icon"][data-provider="microsoft"][aria-hidden="true"]',
          ),
      ).not.toBeNull(),
    );

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "ann@example.test" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Account: ann@example.test" })
          .querySelector('[data-slot="provider-icon"][data-provider="google"]'),
      ).not.toBeNull(),
    );

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "All accounts" }));
    await waitFor(() => expect(trigger().querySelector("[data-slot=provider-icon]")).toBeNull());
    expect(trigger().querySelector("svg.lucide-users")).not.toBeNull();
  });

  it("marks only the current screen with aria-current (guards a wrong or missing active item)", async () => {
    setup("/documents");
    const nav = await sidebar();
    await waitFor(() =>
      expect(nav.getByRole("link", { name: "Documents" }).getAttribute("aria-current")).toBe(
        "page",
      ),
    );
    expect(nav.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("renders one navigation and one switcher so rail and tabs are the same markup (guards separate mobile markup)", async () => {
    setup();
    await sidebar();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Account:/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Teams/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a type as soon as scan progress brings mail, before the scan completes (guards D5 waiting for ScanCompleted)", async () => {
    const state = setup();
    const nav = await sidebar();
    await waitFor(() => expect(nav.getByRole("link", { name: /Personal/ })).toBeTruthy());
    await waitFor(() => expect(state.emitters.length).toBeGreaterThan(0));
    state.mailboxes.a1 = { ...zero, personal: 10, newsletter: 5, promotion: 4 };
    state.progress({ accountId: "a1", phase: "classifying", processed: 4, total: 100 });
    expect(await nav.findByRole("link", { name: /Promotions/ })).toBeTruthy();
  });

  it("tabs through the switcher, then Overview and the types in order (guards a rail or tab bar that reorders focus)", async () => {
    setup();
    const nav = await sidebar();
    await waitFor(() => expect(nav.getByRole("link", { name: /Personal/ })).toBeTruthy());
    const focused: string[] = [];
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      focused.push(
        document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "",
      );
    }
    expect(focused[0]).toMatch(/^Account:/);
    expect(focused[1]).toBe("Overview");
    expect(focused[2]).toMatch(/^Personal/);
    expect(focused[3]).toMatch(/^Transactional/);
  });

  it("keeps theme and language out of the sidebar, with the only controls on Settings (guards pickers in the frame)", async () => {
    setup("/settings");
    await sidebar();
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    const frame = screen.getByRole("complementary");
    expect(within(frame).queryByRole("radiogroup", { name: "Theme" })).toBeNull();
    expect(within(frame).queryByRole("button", { name: "Language" })).toBeNull();
    expect(screen.getAllByRole("radiogroup", { name: "Theme" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Language" })).toHaveLength(1);
  });

  it("reserves top inset and drag region for macOS window controls (guards traffic lights overlapping sidebar content)", async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    try {
      setup();
      await sidebar();
      const header = document.querySelector("[data-slot=sidebar-header]");
      expect(header).not.toBeNull();
      expect(header?.className).toContain("pt-12");
      expect(header?.className).toContain("[-webkit-app-region:drag]");
      expect(header?.className).toContain("[app-region:drag]");
      expect(header?.className).toContain("[-webkit-app-region:no-drag]");
    } finally {
      Object.defineProperty(navigator, "userAgent", { value: original, configurable: true });
    }
  });
});
