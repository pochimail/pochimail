// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf, InputOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";
import { SUMMARY_FOCUS_TARGET_ID } from "./use-summary-sheet.ts";

afterEach(cleanup);

type Digest = OutputOf<"digest.get">;
type Settings = OutputOf<"settings.get">;

const emptyOverview: OutputOf<"overview.get"> = {
  scanned: 12,
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
};

const digest = (values: Partial<Digest> = {}): Digest => ({ ready: true, itemCount: 0, ...values });

const settings = (values: Partial<Settings> = {}): Settings => ({
  autonomy: "suggest",
  capabilities: {
    "catch-what-matters": true,
    declutter: true,
    organize: true,
    "save-documents": true,
  },
  notifications: true,
  theme: "system",
  locale: null,
  tidyCadence: "daily",
  summaryShown: false,
  ...values,
});

const setup = (current: { digest?: Digest; settings?: Settings } = {}) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const state = {
    digest: current.digest ?? digest({ ready: false }),
    settings: current.settings ?? settings(),
    patches: [] as InputOf<"settings.update">[],
    subscribers: [] as ((event: EventOf<"app.events">) => void)[],
    emit(event: EventOf<"app.events">) {
      for (const emit of [...state.subscribers]) emit(event);
    },
    async digestReady(itemCount = 0) {
      await waitFor(() => expect(state.subscribers.length).toBeGreaterThan(0));
      state.emit({ type: "DigestReady", itemCount });
    },
  };
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true }),
      "device.name": () => "device" as const,
      "accounts.list": () => [
        { id: "a1", provider: "google" as const, displayName: "a@example.test" },
      ],
      "mailbox.categories": () => ({
        people: 0,
        records: 0,
        "purchases-travel": 0,
        "sign-ins-security": 0,
        notifications: 0,
        newsletters: 0,
        promotions: 0,
      }),
      "scan.status": () => [],
      "overview.get": () => emptyOverview,
      "digest.get": () => state.digest,
      "settings.get": () => state.settings,
      "settings.update": (patch) => {
        state.patches.push(patch);
        state.settings = {
          ...state.settings,
          ...(patch.tidyCadence === undefined ? {} : { tidyCadence: patch.tidyCadence }),
          ...(patch.summaryShown === undefined ? {} : { summaryShown: patch.summaryShown }),
        };
      },
    },
    subscriptions: {
      "app.events": (_input, emit) => {
        state.subscribers.push(emit);
        return () => {
          state.subscribers = state.subscribers.filter((current) => current !== emit);
        };
      },
      "scan.progress": () => undefined,
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/overview"] },
  );
  render(<App workerClient={client} router={router} />);
  return state;
};

const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "View summary" }));
  return screen.findByRole("dialog");
};

// Guards: a first scan that reopens the sheet on every event, and a close that strands focus in the dialog.
it("opens once on the first digest, returns focus to the Overview, and reopens from View summary", async () => {
  const user = userEvent.setup();
  const state = setup();
  expect(screen.queryByRole("dialog")).toBeNull();

  state.digest = digest({ itemCount: 3, archived: 2, saved: 1 });
  await state.digestReady(3);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  await waitFor(() =>
    expect(state.patches.some((patch) => patch.summaryShown === true)).toBe(true),
  );

  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Later" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement?.id).toBe(SUMMARY_FOCUS_TARGET_ID));

  await state.digestReady(3);
  await waitFor(() =>
    expect(state.patches.filter((patch) => patch.summaryShown === true)).toHaveLength(1),
  );
  expect(screen.queryByRole("dialog")).toBeNull();

  expect(await openSheet(user)).toBeTruthy();
});

// Guards: a second sync adding its figures to the first tally instead of replacing it.
it("shows only the newest digest figures after a second sync", async () => {
  const user = userEvent.setup();
  const state = setup({
    digest: digest({ itemCount: 6, archived: 3, unsubscribed: 3 }),
    settings: settings({ summaryShown: true }),
  });
  const first = await openSheet(user);
  expect(within(first).getByText("emails archived")).toBeTruthy();
  expect(within(first).getByText("newsletters unsubscribed")).toBeTruthy();
  await user.click(within(first).getByRole("button", { name: "Later" }));

  state.digest = digest({ itemCount: 4, saved: 4 });
  await state.digestReady(4);
  const second = await openSheet(user);
  await waitFor(() => expect(within(second).queryByText("emails archived")).toBeNull());
  expect(
    within(second)
      .getAllByRole("definition")
      .map((node) => node.textContent),
  ).toEqual(["4"]);
  expect(within(second).getByText("attachments saved")).toBeTruthy();
  expect(within(second).queryByText("emails archived")).toBeNull();
  expect(within(second).queryByText("newsletters unsubscribed")).toBeNull();
});

// Guards: a cadence choice that is lost on close or reopens with a different label.
it("saves the cadence through settings and reads the same label back", async () => {
  const user = userEvent.setup();
  const state = setup({
    digest: digest({ itemCount: 1, saved: 1 }),
    settings: settings({ summaryShown: true, tidyCadence: "daily" }),
  });
  const sheet = await openSheet(user);
  const labels = ["As it arrives", "Once a day", "Once a week", "Only when I ask"];
  for (const label of labels)
    expect(within(sheet).getByRole("radio", { name: label })).toBeTruthy();
  expect(
    within(sheet).getByRole("radio", { name: "Once a day" }).getAttribute("aria-checked"),
  ).toBe("true");

  await user.click(within(sheet).getByRole("radio", { name: "Only when I ask" }));
  await waitFor(() =>
    expect(state.patches.some((patch) => patch.tidyCadence === "on-request")).toBe(true),
  );
  expect(state.settings.tidyCadence).toBe("on-request");
  await user.click(within(sheet).getByRole("button", { name: "Later" }));

  const reopened = await openSheet(user);
  expect(
    within(reopened).getByRole("radio", { name: "Only when I ask" }).getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    within(reopened).getByRole("radio", { name: "Once a day" }).getAttribute("aria-checked"),
  ).toBe("false");
});

// Guards: a sheet that stays a centred desktop card at phone width.
it("uses the bottom-sheet container classes below the phone breakpoint", async () => {
  const user = userEvent.setup();
  setup({ digest: digest({ itemCount: 1, saved: 1 }), settings: settings({ summaryShown: true }) });
  await openSheet(user);
  const content = document.querySelector('[data-slot="sheet-content"]');
  expect(content?.className).toContain("@max-phone:rounded-t-2xl");
  expect(content?.className).toContain("@min-phone:self-center");
  expect(document.querySelector('[data-slot="sheet-layer"]')?.className).toContain("@container");
});

// Guards: "Where I’d start" always opening the same category whatever the new figures were.
it.each([
  { figures: { unsubscribed: 5, archived: 1, saved: 1 }, count: 5, heading: "Newsletters" },
  { figures: { archived: 4, saved: 1, unsubscribed: 1 }, count: 4, heading: "Alert emails" },
  { figures: { saved: 3, archived: 1, unsubscribed: 1 }, count: 3, heading: "Records" },
])("routes $count new items to $heading", async ({ figures, count, heading }) => {
  const user = userEvent.setup();
  setup({
    digest: digest({ itemCount: 7, ...figures }),
    settings: settings({ summaryShown: true }),
  });
  const sheet = await openSheet(user);
  expect(within(sheet).getByText("Where I’d start")).toBeTruthy();
  expect(within(sheet).getByText(new RegExp(`\\b${heading}\\b`))).toBeTruthy();
  await user.click(within(sheet).getByRole("button", { name: `Review ${count} emails` }));
  expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeTruthy();
});
