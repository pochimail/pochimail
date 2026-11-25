// @vitest-environment jsdom
// Guards: a Connect screen that keeps Microsoft, traps the person in an error or waiting state, skips Setup on a first
// account, shows Setup again when adding one, or leaves Pochi out of the promises.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

const harness = (
  outcomes: OutputOf<"accounts.connect">[],
  existing = 0,
  hang = false,
  listFails = false,
  throwFirst = false,
  initialEntries = ["/connect"],
) => {
  let release: (() => void) | undefined;
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  let connects = 0;
  let lists = 0;
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: existing > 0 }),
      "device.name": () => "Mac" as const,
      "accounts.list": () => {
        lists += 1;
        if (listFails) throw new Error("list failed");
        return Array.from({ length: existing }, (_, n) => ({
          id: `acc-${n}`,
          provider: "google" as const,
          displayName: "a@example.test",
        }));
      },
      "accounts.cancelConnect": () => {
        release?.();
      },
      "accounts.connect": async () => {
        connects += 1;
        if (throwFirst && connects === 1) throw new Error("ipc failed");
        if (hang && connects === 1) await new Promise<void>((resolve) => (release = resolve));
        return outcomes.shift() ?? { status: "failed" as const, reason: "unknown" as const };
      },
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
      "mailbox.types": () => ({
        personal: 0,
        transactional: 0,
        notification: 0,
        newsletter: 0,
        promotion: 0,
      }),
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
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries },
  );
  render(<App workerClient={client} router={router} />);
  return { router, connects: () => connects, lists: () => lists };
};

const gmail = () => screen.getByRole("button", { name: /Continue with Gmail/ });

describe("Connect screen", () => {
  it("offers a real Gmail button only, with Pochi beside the promises and no IMAP line", async () => {
    harness([]);
    const provider = await screen.findByRole("button", { name: /Continue with Gmail/ });
    expect(screen.queryByRole("button", { name: /Continue with Google/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Microsoft/ })).toBeNull();
    expect(screen.queryByText(/IMAP/)).toBeNull();
    expect(screen.queryByText(/version 1\.1/)).toBeNull();
    expect(provider.querySelectorAll("svg")).toHaveLength(1);
    // The logo sits in its own 26px well, the label is a flex child, and the chevron is pinned right.
    const well = provider.querySelector("span[aria-hidden='true']");
    expect(well?.className).toContain("size-6.5");
    const logo = well?.querySelector("img");
    expect(logo?.getAttribute("width")).toBe("20");
    // Vitest inlines the SVG as a data URI; the asset's title identifies the Gmail mark.
    expect(decodeURIComponent(logo?.getAttribute("src") ?? "")).toContain("<title>Gmail</title>");
    expect(provider.className).toContain("cursor-pointer");
    expect(provider.className).toContain("hover:bg-accent");
    // The row uses the 12px control radius (rounded-lg), not the 16px card radius.
    expect(provider.className).toContain("rounded-lg");
    expect(provider.className).not.toContain("rounded-xl");
    expect(screen.getByRole("heading", { name: "My promises" })).toBeTruthy();
    expect(document.querySelector('[data-slot="mascot"]')).toBeTruthy();
    expect(screen.getByText("You keep the control")).toBeTruthy();
    expect(screen.getByText(/add more accounts later/)).toBeTruthy();
  });

  it("a first account goes to Setup", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    // Guards: a Setup form that throws "ResizeObserver is not defined" in jsdom, but only when it mounts before the test ends.
    expect((await screen.findAllByRole("checkbox")).length).toBeGreaterThan(0);
  });

  it("adding an account to an existing setup skips Setup", async () => {
    const h = harness([{ status: "connected", accountId: "acc-9" }], 1);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/overview"));
  });

  it("shows the happy pose on a successful connect before moving on (guards a success with no Pochi reaction)", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }]);
    const navigate = h.router.navigate;
    let releaseNavigate = () => {};
    h.router.navigate = ((options: Parameters<typeof navigate>[0]) => {
      releaseNavigate = () => void navigate(options);
      return Promise.resolve();
    }) as typeof navigate;

    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    await waitFor(() =>
      expect(document.querySelector('[data-slot="mascot"]')?.getAttribute("data-pose")).toBe(
        "happy",
      ),
    );
    expect(h.router.state.location.pathname).toBe("/connect");
    releaseNavigate();
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a cancelled sign-in offers retry and Back instead of a dead end", async () => {
    const h = harness([{ status: "cancelled" }, { status: "connected", accountId: "acc-1" }]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect(await screen.findByText(/Sign-in was cancelled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /Continue with Gmail/ })).toBeTruthy();
    expect(screen.queryByText(/Sign-in was cancelled/)).toBeNull();
    fireEvent.click(gmail());
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(h.connects()).toBe(2);
  });

  it("a failure offers retry and Back; Back restores the sign-in button", async () => {
    const h = harness([
      { status: "failed", reason: "unknown" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("I couldn’t connect");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /Continue with Gmail/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(gmail());
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(h.connects()).toBe(2);
  });

  it("an IPC error stays recoverable through Try again", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }], 0, false, false, true);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("I couldn’t connect");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(h.connects()).toBe(2);
  });

  it("a missing sign-in setup explains itself and stays recoverable", async () => {
    const h = harness([
      { status: "failed", reason: "not-configured" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("no Google sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a missing email address explains itself and stays recoverable", async () => {
    const h = harness([
      { status: "failed", reason: "no-address" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("email address");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a provider failure names the next step and stays recoverable", async () => {
    const h = harness([
      { status: "failed", reason: "provider-failed" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("unavailable local storage names a restart and stays recoverable", async () => {
    const h = harness([
      { status: "failed", reason: "storage-unavailable" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Restart Pochimail");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a failing account list does not hide a connect: it goes to Setup as a first account", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }], 0, false, true);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Cancel while waiting shows a clear waiting state, stops the sign-in and stays recoverable", async () => {
    const h = harness(
      [{ status: "cancelled" }, { status: "connected", accountId: "acc-1" }],
      0,
      true,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Gmail/ }));
    expect(await screen.findByText(/Waiting for you to sign in/)).toBeTruthy();
    const cancelButton = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    fireEvent.click(cancelButton);
    await waitFor(() => expect(cancelButton.disabled || !cancelButton.isConnected).toBe(true));
    expect(await screen.findByText(/Sign-in was cancelled/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  // Guards: the add-account exit competing with the title as a large, bordered or full-width button.
  it("add-account Back is a quiet, arrow-led control above the title and still leaves", async () => {
    const h = harness([], 1);
    const back = await screen.findByRole("button", { name: "Back" });
    const title = screen.getByRole("heading", { name: "Connect an email account" });
    expect(title.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(back.getAttribute("data-variant")).toBe("ghost");
    expect(back.getAttribute("data-size")).toBe("sm");
    expect(back.className).toContain("self-start");
    expect(back.className).not.toContain("w-full");
    expect(back.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await userEvent.click(back);
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/settings"));
  });

  // Guards: the add-account redirect losing the app frame and leaving no way back to Settings.
  it("Back from the add-account redirect returns through history to the previous screen", async () => {
    const h = harness([], 1, false, false, false, ["/settings"]);
    await userEvent.click(await screen.findByRole("button", { name: /Account:/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Add another account" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/connect"));

    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/settings"));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  // Guards: a cold /connect with an existing account offering no escape from the onboarding frame.
  it("Back falls back to Settings when the redirect has no history", async () => {
    const h = harness([], 1);
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/settings"));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  // Guards: first-run Connect keeping its two-column reference without an extra exit.
  it("first-run Connect has no Back control", async () => {
    const h = harness([]);
    await screen.findByRole("button", { name: /Continue with Gmail/ });
    await waitFor(() => expect(h.lists()).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
