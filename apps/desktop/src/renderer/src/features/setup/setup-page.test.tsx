// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import type { AppSettings } from "#shared/settings.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(() => {
  cleanup();
});

type Saved = Pick<AppSettings, "autonomy" | "capabilities">;

type Options = {
  failSave?: boolean;
  /** Accounts whose scan.start fails the first time it is called. */
  failScanOnce?: string[];
  /** settings.get fails this many times before answering. */
  settingsFailures?: number;
  /** Hold the real save/scan calls so the pose can be observed mid-flight. */
  holdSave?: boolean;
  holdScan?: boolean;
};

const harness = (opts: Options = {}) => {
  let settingsFailures = opts.settingsFailures ?? 0;
  const failScan = new Set(opts.failScanOnce ?? []);
  let releaseSave = () => {};
  let releaseScan = () => {};
  const saveGate = opts.holdSave
    ? new Promise<void>((resolve) => {
        releaseSave = resolve;
      })
    : Promise.resolve();
  const scanGate = opts.holdScan
    ? new Promise<void>((resolve) => {
        releaseScan = resolve;
      })
    : Promise.resolve();
  const calls: string[] = [];
  let saved: Saved = {
    autonomy: "suggest",
    capabilities: {
      "catch-what-matters": true,
      declutter: true,
      organize: true,
      "save-documents": true,
    },
  };
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true, needsReauth: [] }),
      "device.name": () => "Mac" as const,
      "accounts.list": () => [
        { id: "acc-1", provider: "google" as const, displayName: "a@example.test" },
        { id: "acc-2", provider: "microsoft" as const, displayName: "b@example.test" },
      ],
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
      "mailbox.types": () => ({
        personal: 0,
        transactional: 0,
        notification: 0,
        newsletter: 0,
        promotion: 0,
      }),
      "digest.get": () => ({ ready: false, itemCount: 0, archived: 0, saved: 0, unsubscribed: 0 }),
      "settings.get": () => {
        if (settingsFailures > 0) {
          settingsFailures -= 1;
          throw new Error("unreadable");
        }
        return { ...saved, notifications: true };
      },
      "settings.update": async (patch) => {
        await saveGate;
        if (opts.failSave) throw new Error("disk full");
        calls.push("settings.update");
        saved = {
          autonomy: patch.autonomy ?? saved.autonomy,
          capabilities: patch.capabilities ?? saved.capabilities,
        };
        return undefined;
      },
      "scan.start": async ({ accountId }) => {
        await scanGate;
        calls.push(`scan.start:${accountId}`);
        if (failScan.delete(accountId)) throw new Error("provider down");
        return { jobId: "job-1" };
      },
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/setup"] },
  );
  render(<App workerClient={client} router={router} />);
  return {
    calls,
    saved: () => saved,
    releaseSave: () => releaseSave(),
    releaseScan: () => releaseScan(),
  };
};

describe("Setup screen", () => {
  it("starts with every capability on and Suggest selected (guards shipping a riskier default than the brief)", async () => {
    harness();
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Suggest" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText("Recommended")).toBeTruthy();
  });

  it("Start sorting saves the choice, starts every account's scan and opens Overview (guards a dropped choice or a user left on Setup)", async () => {
    const h = harness();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Declutter" }));
    fireEvent.click(screen.getByRole("radio", { name: "Just look" }));
    fireEvent.click(screen.getByRole("button", { name: "Start sorting" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy());
    expect(h.calls).toEqual(["settings.update", "scan.start:acc-1", "scan.start:acc-2"]);
    expect(h.saved().autonomy).toBe("just-look");
    expect(h.saved().capabilities.declutter).toBe(false);
  });

  it("shows saving, then reading while the real save and scan-start calls run (guards unused poses)", async () => {
    const h = harness({ holdSave: true, holdScan: true });
    const pose = () => document.querySelector('[data-slot="mascot"]')?.getAttribute("data-pose");
    fireEvent.click(await screen.findByRole("button", { name: "Start sorting" }));
    await waitFor(() => expect(pose()).toBe("saving"));
    h.releaseSave();
    await waitFor(() => expect(pose()).toBe("reading"));
    h.releaseScan();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy());
  });

  it("a double click on Start sorting starts each scan once (guards duplicate scans)", async () => {
    const h = harness();
    const button = await screen.findByRole("button", { name: "Start sorting" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy());
    expect(h.calls.filter((call) => call.startsWith("scan.start"))).toEqual([
      "scan.start:acc-1",
      "scan.start:acc-2",
    ]);
  });

  it("shows the Autopilot reminder only while Autopilot is selected (guards choosing it without the unsubscribe and People wording)", async () => {
    harness();
    await screen.findByRole("radio", { name: "Suggest" });
    expect(screen.queryByText(/at least 90% sure/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Autopilot" }));
    expect(screen.getByText(/at least 90% sure/)).toBeTruthy();
    expect(screen.getByText(/You can undo it, except an unsubscribe/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Suggest" }));
    expect(screen.queryByText(/at least 90% sure/)).toBeNull();
  });

  it("the invariants line names the unsubscribe exception like the Autopilot reminder (guards contradictory undo promises)", async () => {
    harness();
    expect((await screen.findByText(/In every mode, I never act/)).textContent).toMatch(
      /except an unsubscribe/,
    );
  });

  it("stays on Setup with an alert when saving fails (guards moving on with a scan nobody configured)", async () => {
    const h = harness({ failSave: true });
    fireEvent.click(await screen.findByRole("button", { name: "Start sorting" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't start sorting/);
    expect(h.calls).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
  });

  it("a retry after one account's scan failed starts only that account (guards a duplicate scan on the account that already runs)", async () => {
    const h = harness({ failScanOnce: ["acc-2"] });
    fireEvent.click(await screen.findByRole("button", { name: "Start sorting" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start sorting" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy());
    expect(h.calls.filter((call) => call === "scan.start:acc-1")).toHaveLength(1);
    expect(h.calls.filter((call) => call === "scan.start:acc-2")).toHaveLength(2);
  });

  it("disables Start sorting when no capability is checked (guards a scan with nothing enabled)", async () => {
    const h = harness();
    for (const box of await screen.findAllByRole("checkbox")) fireEvent.click(box);
    const button = screen.getByRole("button", { name: "Start sorting" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Choose at least one thing for me to help with.")).toBeTruthy();
    fireEvent.click(button);
    expect(h.calls).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Organize" }));
    expect(button.disabled).toBe(false);
  });

  it("shows an error and a retry when the saved choices cannot be read (guards an empty screen with no way out)", async () => {
    harness({ settingsFailures: 1 });
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't load your choices/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Start sorting" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
