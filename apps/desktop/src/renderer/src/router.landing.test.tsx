// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "./app/app.tsx";

afterEach(cleanup);

const createFakeAppClient = (hasConnectedAccount: boolean) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount }),
      "device.name": () => "Mac" as const,
      "accounts.list": () => [],
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
      "app.events": () => undefined,
      "scan.progress": () => undefined,
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  return {
    client,
    close: () => {
      port1.close();
      port2.close();
    },
  };
};

describe("first-run redirect from app.state", () => {
  it("lands on Welcome on first launch when no account is connected", async () => {
    const fake = createFakeAppClient(false);
    render(<App workerClient={fake.client} />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Clean up your email. Keep what matters." }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
    fake.close();
  });

  it("lands on Overview when a connected account already exists", async () => {
    const fake = createFakeAppClient(true);
    render(<App workerClient={fake.client} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy());
    expect(
      screen.queryByRole("heading", { name: "Clean up your email. Keep what matters." }),
    ).toBeNull();
    fake.close();
  });

  // Guards: a Get started button that does not lead to Connect, or a stepper that does not advance.
  it("Get started leads to Connect and moves the stepper to step 2", async () => {
    const fake = createFakeAppClient(false);
    render(<App workerClient={fake.client} />);
    await waitFor(() => expect(screen.getByRole("list", { name: "Step 1 of 3" })).toBeTruthy());
    fireEvent.click(screen.getByRole("link", { name: "Get started" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Connect an email account" })).toBeTruthy(),
    );
    expect(screen.getByRole("list", { name: "Step 2 of 3" })).toBeTruthy();
    fake.close();
  });

  // Guards: the privacy promise ignoring the OS name (showing "device" or a raw placeholder).
  it("Welcome names the OS in the privacy promise", async () => {
    const fake = createFakeAppClient(false);
    render(<App workerClient={fake.client} />);
    await waitFor(() =>
      expect(screen.getByText(/Your email never leaves this Mac\./)).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(/[{}[\]]/);
    fake.close();
  });

  // Guards: focus dropping to <body> when Get started unmounts (keyboard users lose their place).
  it("moves focus to the Connect heading after Get started", async () => {
    const fake = createFakeAppClient(false);
    render(<App workerClient={fake.client} />);
    fireEvent.click(await screen.findByRole("link", { name: "Get started" }));
    const heading = await screen.findByRole("heading", { name: "Connect an email account" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fake.close();
  });

  // Guards: the compact pickers vanishing from sidebar-less screens when the sidebar is cleaned up.
  it("keeps one compact theme and language control on Welcome and Connect", async () => {
    const fake = createFakeAppClient(false);
    render(<App workerClient={fake.client} />);
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Get started" }));
    await screen.findByRole("heading", { name: "Connect an email account" });
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
    fake.close();
  });

  // Guards: the controls drifting off the window's right edge, or the mac title bar losing its drag area.
  it("pins the onboarding appearance controls top-right and makes the header draggable on macOS", async () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    const fake = createFakeAppClient(false);
    try {
      render(<App workerClient={fake.client} />);
      await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy());

      const wrapper = document.querySelector('[data-slot="appearance-controls"]')?.parentElement;
      const header = wrapper?.parentElement;
      expect(wrapper?.classList.contains("absolute")).toBe(true);
      expect(wrapper?.classList.contains("top-1/2")).toBe(true);
      expect(wrapper?.classList.contains("-translate-y-1/2")).toBe(true);
      expect(wrapper?.classList.contains("right-4")).toBe(true);
      expect(wrapper?.classList.contains("@phone:right-8")).toBe(false);
      expect(wrapper?.className).toContain("[-webkit-app-region:no-drag]");
      expect(wrapper?.className).toContain("[app-region:no-drag]");
      expect(header?.tagName).toBe("HEADER");
      expect(header?.className).toContain("[-webkit-app-region:drag]");
      expect(header?.className).toContain("[app-region:drag]");
      expect(header?.nextElementSibling?.tagName).toBe("MAIN");
    } finally {
      fake.close();
      Object.defineProperty(navigator, "userAgent", { value: original, configurable: true });
    }
  });

  // Guards: the header becoming a drag region where the OS has its own title bar.
  it("leaves the onboarding header undraggable outside macOS", async () => {
    const fake = createFakeAppClient(false);
    render(<App workerClient={fake.client} />);
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy());
    const header = document.querySelector("header");
    expect(header?.className).not.toContain("app-region:drag");
    fake.close();
  });
});
