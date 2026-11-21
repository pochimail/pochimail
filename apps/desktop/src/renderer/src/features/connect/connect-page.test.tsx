// @vitest-environment jsdom
// Guards: a Connect screen that keeps Microsoft, traps the person in an error or waiting state, skips Setup on a first
// account, shows Setup again when adding one, or leaves Pochi out of the promises.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
) => {
  let release: (() => void) | undefined;
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  let connects = 0;
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: existing > 0 }),
      "device.name": () => "Mac" as const,
      "accounts.list": () => {
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
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/connect"] },
  );
  render(<App workerClient={client} router={router} />);
  return { router, connects: () => connects };
};

const google = () => screen.getByRole("button", { name: /Continue with Google/ });

describe("Connect screen", () => {
  it("offers Google only, with Pochi beside the promises and the IMAP line", async () => {
    harness([]);
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Microsoft/ })).toBeNull();
    expect(screen.queryByText(/Coming soon/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }).querySelectorAll("svg"),
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "My promises" })).toBeTruthy();
    expect(document.querySelector('[data-slot="mascot"]')).toBeTruthy();
    expect(screen.getByText("Nothing is deleted without your OK")).toBeTruthy();
    expect(screen.getByText(/add more accounts later/)).toBeTruthy();
    expect(screen.getByText(/IMAP\) are coming in version 1\.1/)).toBeTruthy();
  });

  it("a first account goes to Setup", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("adding an account to an existing setup skips Setup", async () => {
    const h = harness([{ status: "connected", accountId: "acc-9" }], 1);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/overview"));
  });

  it("a cancelled sign-in offers retry and Back instead of a dead end", async () => {
    const h = harness([{ status: "cancelled" }, { status: "connected", accountId: "acc-1" }]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect(await screen.findByText(/Sign-in was cancelled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.queryByText(/Sign-in was cancelled/)).toBeNull();
    fireEvent.click(google());
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(h.connects()).toBe(2);
  });

  it("a failure offers retry and Back; Back restores the sign-in button", async () => {
    const h = harness([
      { status: "failed", reason: "unknown" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("I couldn’t connect");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(google());
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(h.connects()).toBe(2);
  });

  it("an IPC error stays recoverable through Try again", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }], 0, false, false, true);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
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
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("no Google sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a missing email address explains itself and stays recoverable", async () => {
    const h = harness([
      { status: "failed", reason: "no-address" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("email address");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a provider failure names the next step and stays recoverable", async () => {
    const h = harness([
      { status: "failed", reason: "provider-failed" },
      { status: "connected", accountId: "acc-1" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
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
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Restart Pochimail");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });

  it("a failing account list does not hide a connect: it goes to Setup as a first account", async () => {
    const h = harness([{ status: "connected", accountId: "acc-1" }], 0, false, true);
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Cancel while waiting shows a clear waiting state, stops the sign-in and stays recoverable", async () => {
    const h = harness(
      [{ status: "cancelled" }, { status: "connected", accountId: "acc-1" }],
      0,
      true,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect(await screen.findByText(/Waiting for you to sign in/)).toBeTruthy();
    const cancelButton = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    fireEvent.click(cancelButton);
    await waitFor(() => expect(cancelButton.disabled || !cancelButton.isConnected).toBe(true));
    expect(await screen.findByText(/Sign-in was cancelled/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe("/setup"));
  });
});
