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

type Overview = OutputOf<"overview.get">;
const empty: Overview = {
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
};
const sorted: Overview = {
  scanned: 1000,
  toReview: 10,
  waiting: 7,
  deadlines: 1,
  important: 2,
  oldestWaitingDays: 9,
  cleanable: [
    { category: "newsletters", count: 300 },
    { category: "notifications", count: 120 },
  ],
  figures: {
    archived: 120,
    savedCount: 412,
    savedSize: 1_200_000_000,
    deletableSize: 3_100_000_000,
    unsubscribed: 120,
    totalSize: 6_400_000_000,
  },
};

const setup = (
  initial: Record<string, Overview>,
  path = "/overview",
  locale?: "en" | "fr" | "ja",
) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const state = {
    overviews: structuredClone(initial),
    asked: [] as (string | undefined)[],
    calls: [] as string[],
    /** The worker's live scan jobs; Pause and Resume change them like the real runner does. */
    jobs: [] as OutputOf<"scan.status">,
    failOverview: false,
    stopped: 0,
    emitters: new Map<string, ((e: EventOf<"scan.progress">) => void)[]>(),
    /** Sends progress once the screen has subscribed for that account. */
    progress: async (event: EventOf<"scan.progress">) => {
      await waitFor(() => expect(state.emitters.has(event.accountId)).toBe(true));
      for (const emit of state.emitters.get(event.accountId) ?? []) emit(event);
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
      "mailbox.categories": () => ({
        people: 0,
        records: 0,
        "purchases-travel": 0,
        "sign-ins-security": 0,
        notifications: 0,
        newsletters: 0,
        promotions: 0,
      }),
      "scan.status": ({ accountIds }) => state.jobs.filter((j) => accountIds.includes(j.accountId)),
      "overview.get": ({ accountId }) => {
        state.asked.push(accountId);
        if (state.failOverview) throw new Error("down");
        return state.overviews[accountId ?? "all"] ?? empty;
      },
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
        ...(locale !== undefined ? { locale } : {}),
      }),
      "scan.pause": ({ jobId }) => {
        state.calls.push(`pause:${jobId}`);
        state.jobs = state.jobs.map((j) => (j.jobId === jobId ? { ...j, status: "paused" } : j));
      },
      "scan.resume": ({ jobId }) => {
        state.calls.push(`resume:${jobId}`);
        state.jobs = state.jobs.map((j) => (j.jobId === jobId ? { ...j, status: "running" } : j));
      },
    },
    subscriptions: {
      "app.events": () => undefined,
      "scan.progress": ({ accountId }, emit) => {
        state.emitters.set(accountId, [...(state.emitters.get(accountId) ?? []), emit]);
        return () => {
          state.stopped++;
        };
      },
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [path] },
  );
  render(<App workerClient={client} router={router} />);
  return Object.assign(state, { router });
};

const reviewButton = (rowLabel: string) => {
  const row = screen.getByText(rowLabel).closest("li");
  if (row === null) throw new Error(`No row for ${rowLabel}`);
  return within(row).getByRole("button", { name: "Review" });
};

describe("overview", () => {
  it("shows the figures the worker computed, hiding rows that are zero (guards zeros in a ledger)", async () => {
    setup({ all: sorted });
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(await screen.findByText("people are waiting on you")).toBeTruthy();
    expect(screen.getByText("The oldest has waited 9 days")).toBeTruthy();
    expect(screen.getByText("Unsubscribe from newsletters")).toBeTruthy();
    expect(screen.getByText("Archive app and social notifications")).toBeTruthy();
    expect(
      screen.getByText(
        "Automated alerts, not emails from people. Review opens the list — nothing is archived until you approve.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Delete old promotions")).toBeNull();
    expect(screen.getByText("Emails that look important are never selected for you.")).toBeTruthy();
    expect(screen.getByText("I have counts, not sizes, so I can’t show GB freed.")).toBeTruthy();
  });

  // Guards: the cumulative archived/saved/unsubscribed figures and the deletable GB headline (#114).
  it("shows the archived, saved and unsubscribed figures with the deletable size apart from the clean-up list", async () => {
    setup({ all: sorted });
    expect(await screen.findByText("emails archived")).toBeTruthy();
    expect(screen.getByText("attachments saved · 1.2 GB")).toBeTruthy();
    expect(screen.getByText("newsletters unsubscribed")).toBeTruthy();
    expect(screen.getByText("3.1 GB you can free, out of 6.4 GB")).toBeTruthy();
    expect(screen.getByText("412")).toBeTruthy();
  });

  it("formats the figures and the deletable size in French and Japanese (guards English-only sizes)", async () => {
    setup({ all: sorted }, "/overview", "fr");
    expect(await screen.findByText("emails archivés")).toBeTruthy();
    expect(screen.getByText("pièces jointes enregistrées · 1,2 Go")).toBeTruthy();
    expect(screen.getByText("3,1 Go à libérer, sur 6,4 Go")).toBeTruthy();
    cleanup();
    setup({ all: sorted }, "/overview", "ja");
    expect(await screen.findByText("アーカイブしたメール")).toBeTruthy();
    expect(screen.getByText("保存した添付ファイル · 1.2 GB")).toBeTruthy();
    expect(screen.getByText("合計6.4 GBのうち、3.1 GBを空けられます。")).toBeTruthy();
  });

  it("hides the figures area when no action has happened and nothing is deletable (guards a ledger of zeros)", async () => {
    setup({ all: { ...empty, scanned: 40 } });
    expect(await screen.findByText("Nothing needs you right now.")).toBeTruthy();
    expect(screen.queryByText("emails archived")).toBeNull();
    expect(screen.queryByText(/you can free/)).toBeNull();
  });

  it("changes figures in place when a progress event arrives, without going back to a loading state (guards flicker and stale numbers)", async () => {
    const state = setup({ all: { ...sorted, waiting: 7 } });
    state.jobs = [
      { accountId: "a1", jobId: "j1", status: "running", processed: 500 },
      { accountId: "a2", jobId: "j2", status: "running", processed: 0 },
    ];
    await screen.findByText("people are waiting on you");
    state.overviews.all = { ...sorted, waiting: 8, toReview: 11 };
    await state.progress({ accountId: "a1", phase: "classifying", processed: 500, total: 1000 });
    await state.progress({ accountId: "a2", phase: "classifying", processed: 0, total: 1000 });

    await waitFor(() => expect(screen.getByText("8")).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByRole("status", { name: "Loading your overview" })).toBeNull();
    const strip = await screen.findByText("500 of 2,000 emails sorted");
    expect(strip).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("pauses and resumes only live jobs through the worker, never starting a scan (guards Pause that restarts finished scans or a lookup that resumes)", async () => {
    const user = userEvent.setup();
    const state = setup({ all: sorted });
    state.jobs = [{ accountId: "a1", jobId: "job-a1", status: "running", processed: 10 }];
    await screen.findByText("people are waiting on you");

    await user.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.getByText("Paused. Nothing was changed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeTruthy();
    expect(state.calls).toEqual(["pause:job-a1", "resume:job-a1"]);
  });

  it("shows Resume when the screen opens while the worker's scan is paused (guards pause state kept only in the component, stranding the scan after a reload)", async () => {
    const state = setup({ all: sorted });
    state.jobs = [{ accountId: "a1", jobId: "job-a1", status: "paused", processed: 400 }];
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.getByText("Paused. Nothing was changed.")).toBeTruthy();
  });

  it("offers a retry when the figures cannot be loaded and recovers (guards skeletons forever after a failed first load)", async () => {
    const user = userEvent.setup();
    const state = setup({ all: sorted });
    state.failOverview = true;
    expect(
      await screen.findByRole(
        "heading",
        { name: "I could not load your overview." },
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    state.failOverview = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("people are waiting on you")).toBeTruthy();
  });

  it("refetches the figures at most once per second however many events arrive (guards a refetch per event)", async () => {
    const state = setup({ all: sorted });
    await screen.findByText("people are waiting on you");
    const before = state.asked.length;
    for (let i = 1; i <= 20; i++)
      await state.progress({ accountId: "a1", phase: "classifying", processed: i, total: 100 });
    await new Promise((r) => setTimeout(r, 1300));
    // One immediate refresh and at most one trailing one for 20 events inside ~1 s.
    expect(state.asked.length - before).toBeLessThanOrEqual(2);
    expect(state.asked.length - before).toBeGreaterThanOrEqual(1);
  });

  it("stops listening when the screen is left (guards leaked subscriptions after navigating away)", async () => {
    const state = setup({ all: sorted });
    await screen.findByText("people are waiting on you");
    await waitFor(() => expect(state.emitters.get("a1")?.length).toBeGreaterThan(0));
    cleanup();
    await waitFor(() => expect(state.stopped).toBeGreaterThan(0));
  });

  it("asks for the selected account only and answers with its numbers (guards an Overview that ignores the account switcher)", async () => {
    const state = setup(
      { all: sorted, a2: { ...empty, scanned: 5, toReview: 2, waiting: 2, oldestWaitingDays: 1 } },
      "/overview?account=a2",
    );
    await screen.findByText("people are waiting on you");
    expect(state.asked).toEqual(["a2"]);
    expect(screen.queryByText("Unsubscribe from newsletters")).toBeNull();
    expect(within(document.body).getByText("1 account")).toBeTruthy();
  });

  it("shows the empty state, not a ledger of zeros, for an account with no emails (guards zeros on a fresh account)", async () => {
    setup({ all: empty });
    expect(await screen.findByRole("heading", { name: "No emails yet" })).toBeTruthy();
    expect(screen.queryByText("Catch what matters")).toBeNull();
  });

  it("says nothing needs attention when the mailbox is sorted and clean (guards an empty section with no sentence)", async () => {
    setup({ all: { ...empty, scanned: 40 } });
    expect(await screen.findByText("Nothing needs you right now.")).toBeTruthy();
    expect(screen.getByText("Nothing to clean up right now.")).toBeTruthy();
  });

  // Guards: Clean up first, then Catch what matters, stacked as in the reference screen.
  it("shows Clean up before Catch what matters in one column", async () => {
    setup({ all: sorted });
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    await screen.findByText("people are waiting on you");

    const headings = within(screen.getByRole("main")).getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Clean up",
      "Catch what matters",
    ]);
    const parent = headings[0]?.closest("section")?.parentElement;
    expect(parent).toBe(headings[1]?.closest("section")?.parentElement);
    expect(parent?.className).toContain("flex-col");
    expect(parent?.className).not.toContain("grid-cols-2");
  });

  // Guards: a Review button that opens another row's list (and a target that could pre-select an email).
  it("opens its own Review list for each recommendation, with no email in the target", async () => {
    const user = userEvent.setup();
    const { router } = setup({
      all: {
        ...sorted,
        cleanable: [
          { category: "promotions", count: 400 },
          { category: "notifications", count: 120 },
          { category: "sign-ins-security", count: 80 },
          { category: "newsletters", count: 300 },
        ],
      },
    });
    await screen.findByText("Delete old promotions");
    const cases = [
      { label: "Delete old promotions", path: "/category/promotions", review: "delete" },
      {
        label: "Delete expired sign-in codes",
        path: "/category/sign-ins-security",
        review: "delete",
      },
      {
        label: "Archive app and social notifications",
        path: "/category/notifications",
        review: "archive",
      },
      {
        label: "Unsubscribe from newsletters",
        path: "/category/newsletters",
        review: "unsubscribe",
      },
    ];
    for (const { label, path, review } of cases) {
      await user.click(reviewButton(label));
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
      expect(router.state.location.search).toMatchObject({ review });
      expect(JSON.stringify(router.state.location.search)).not.toMatch(/@|message|email/iu);
      await user.click(await screen.findByRole("button", { name: "Back to overview" }));
      await screen.findByText("Delete old promotions");
    }
  });

  // Guards: a protecting signal's Review button opening a delete list that pre-selects that email.
  it("opens a catch-only list for each signal, never a delete list", async () => {
    const user = userEvent.setup();
    const { router } = setup({ all: sorted });
    await screen.findByText("people are waiting on you");
    const cases: readonly (readonly [string, string])[] = [
      ["people are waiting on you", "waiting"],
      ["email mentions a deadline", "deadlines"],
      ["emails from important people", "important"],
    ];
    for (const [label, review] of cases) {
      await user.click(reviewButton(label));
      await waitFor(() => expect(router.state.location.pathname).toBe("/category/people"));
      expect(router.state.location.search).toMatchObject({ review });
      expect(router.state.location.search).not.toMatchObject({ review: "delete" });
      await user.click(await screen.findByRole("button", { name: "Back to overview" }));
      await screen.findByText("people are waiting on you");
    }
  });

  // Guards: a fabricated GB figure from email counts (no bytes in the contract means no GB).
  it("shows a count, not a GB figure", async () => {
    setup({
      all: {
        ...sorted,
        figures: empty.figures,
        cleanable: [{ category: "promotions", count: 400 }],
      },
    });
    await screen.findByText("Delete old promotions");
    expect(screen.getByText("400")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d[\d,.]*\s*GB/u);
  });
});
