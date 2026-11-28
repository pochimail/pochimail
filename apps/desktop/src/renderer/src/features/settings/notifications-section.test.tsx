// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

/** A real RPC server behind the public App entry point; `failUpdates` makes every settings.update fail. */
function fakeApp(notifications: boolean) {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const state = { notifications, failUpdates: false, gate: undefined as Promise<void> | undefined };
  const updates: object[] = [];
  serveRpc(fromDomPort(port2), {
    procedures: {
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: state.notifications,
        locale: "en" as const,
      }),
      "settings.update": async (patch) => {
        updates.push(patch);
        await state.gate;
        if (state.failUpdates) throw new Error("storage");
        state.notifications = patch.notifications ?? state.notifications;
        return undefined;
      },
    },
    subscriptions: { "app.events": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/settings"] },
  );
  render(<App workerClient={client} router={router} />);
  return { state, updates };
}

const notificationsSwitch = () => screen.findByRole("switch", { name: "Show notifications" });
const isOn = (toggle: HTMLElement) => toggle.getAttribute("aria-checked") === "true";
const isEnabled = (toggle: HTMLElement) => !(toggle as HTMLButtonElement).disabled;

describe("Settings › Notifications", () => {
  // Guards: a switch that shows the default instead of the saved choice, or never writes it.
  it("shows the saved choice and saves a change through settings.update", async () => {
    const fake = fakeApp(false);
    const toggle = await notificationsSwitch();
    await waitFor(() => expect(isEnabled(toggle)).toBe(true));
    expect(isOn(toggle)).toBe(false);

    await userEvent.click(toggle);

    await waitFor(() => expect(isOn(toggle)).toBe(true));
    expect(fake.updates).toEqual([{ notifications: true }]);
    expect(fake.state.notifications).toBe(true);
  });

  // Guards: a failed save leaving the switch showing a choice that was never stored, with no word to the user.
  it("a failed save puts the switch back and shows the toast", async () => {
    const fake = fakeApp(true);
    const toggle = await notificationsSwitch();
    await waitFor(() => expect(isEnabled(toggle)).toBe(true));
    fake.state.failUpdates = true;

    await userEvent.click(toggle);

    expect(await screen.findByText("I couldn't save that setting. Please try again.")).toBeTruthy();
    await waitFor(() => expect(isOn(toggle)).toBe(true));
    expect(fake.state.notifications).toBe(true);
  });

  // Guards: a failed save restoring the opposite of the click instead of the stored value when two changes overlap.
  it("two overlapping failed saves both go back to the stored value", async () => {
    const fake = fakeApp(false);
    const toggle = await notificationsSwitch();
    await waitFor(() => expect(isEnabled(toggle)).toBe(true));
    let release = () => {};
    fake.state.gate = new Promise((resolve) => {
      release = resolve;
    });
    fake.state.failUpdates = true;

    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await waitFor(() => expect(fake.updates).toHaveLength(2));
    release();

    await waitFor(() => expect(screen.getAllByText(/couldn't save/).length).toBeGreaterThan(0));
    await waitFor(() => expect(isOn(toggle)).toBe(false));
  });

  // Guards: the section's copy promising more than ships (quiet hours, names and subjects).
  it("describes only counts-only notifications for sorting and the digest", async () => {
    fakeApp(true);
    await notificationsSwitch();

    expect(screen.getByRole("heading", { level: 2, name: "Notifications" })).toBeTruthy();
    expect(screen.getByText(/only counts, never names or subjects/i)).toBeTruthy();
  });
});
