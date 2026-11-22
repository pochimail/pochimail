// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

type Counts = OutputOf<"mailbox.categories">;
const zero: Counts = {
  people: 0,
  records: 0,
  "purchases-travel": 0,
  "sign-ins-security": 0,
  notifications: 0,
  newsletters: 0,
  promotions: 0,
};
const mailboxes: Record<string, Counts> = {
  a1: { ...zero, people: 10, newsletters: 5 },
  a2: { ...zero, people: 2, records: 3 },
};

const setup = (initialPath = "/overview") => {
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
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true }),
      "device.name": () => "device" as const,
      "accounts.list": () => [
        { id: "a1", provider: "google" as const, displayName: "ann@example.test" },
        { id: "a2", provider: "microsoft" as const, displayName: "ann@work.example.test" },
      ],
      "mailbox.categories": ({ accountIds }) => {
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
      }),
      "scan.status": () => [],
      "digest.get": () => ({ ready: false, itemCount: 0 }),
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
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

describe("app frame", () => {
  it("hides a category with no email and shows it once it gets mail (guards D5: empty categories listed)", async () => {
    const state = setup();
    const nav = await sidebar();
    await waitFor(() => expect(nav.getByRole("link", { name: /People/ })).toBeTruthy());
    expect(nav.queryByRole("link", { name: /Promotions/ })).toBeNull();
    expect(nav.queryByRole("link", { name: /Purchases/ })).toBeNull();

    state.mailboxes.a1 = { ...zero, people: 10, newsletters: 5, promotions: 4 };
    state.emit({ type: "ScanCompleted", accountId: "a1", processed: 4 });
    expect(await nav.findByRole("link", { name: /Promotions/ })).toBeTruthy();
  });

  it("changes the counts when switching account, without remounting the content (guards a reload on switch)", async () => {
    setup();
    const nav = await sidebar();
    const main = await screen.findByRole("main");
    await waitFor(() =>
      expect(nav.getByRole("link", { name: /People/ }).textContent).toContain("12"),
    );

    await userEvent.click(screen.getByRole("button", { name: /Account: All accounts/ }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "ann@work.example.test" }),
    );

    await waitFor(() =>
      expect(nav.getByRole("link", { name: /People/ }).textContent).toContain("2"),
    );
    expect(nav.queryByRole("link", { name: /Newsletters/ })).toBeNull();
    expect(nav.getByRole("link", { name: /Records/ }).textContent).toContain("3");
    expect(screen.getByRole("main")).toBe(main);
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

  it("shows a category as soon as scan progress brings mail, before the scan completes (guards D5 waiting for ScanCompleted)", async () => {
    const state = setup();
    const nav = await sidebar();
    await waitFor(() => expect(nav.getByRole("link", { name: /People/ })).toBeTruthy());
    await waitFor(() => expect(state.emitters.length).toBeGreaterThan(0));
    state.mailboxes.a1 = { ...zero, people: 10, newsletters: 5, promotions: 4 };
    state.progress({ accountId: "a1", phase: "classifying", processed: 4, total: 100 });
    expect(await nav.findByRole("link", { name: /Promotions/ })).toBeTruthy();
  });

  it("tabs through the switcher, the compact controls, then Overview and the categories in order (guards a rail or tab bar that reorders focus)", async () => {
    setup();
    const nav = await sidebar();
    await waitFor(() => expect(nav.getByRole("link", { name: /People/ })).toBeTruthy());
    const focused: string[] = [];
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      focused.push(
        document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "",
      );
    }
    expect(focused[0]).toMatch(/^Account:/);
    expect(focused.slice(1, 3)).toEqual(["System", "Language"]);
    expect(focused[3]).toBe("Overview");
    expect(focused[4]).toMatch(/^People/);
    expect(focused[5]).toMatch(/^Records/);
  });
});
