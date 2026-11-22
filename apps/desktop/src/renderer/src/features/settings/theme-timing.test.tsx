// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort, type Transport } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

type Theme = "system" | "light" | "dark";
type Locale = "en" | "fr" | "ja" | null;
type Stored = { readonly theme: Theme; readonly locale: Locale };

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const isSettingsUpdate = (message: unknown): boolean =>
  typeof message === "object" &&
  message !== null &&
  "procedure" in message &&
  message.procedure === "settings.update";

/** Public App + RPC entry point; the transport records the root class at the moment a write is sent. */
function fakeApp(initial: Stored, write: () => Promise<undefined> = async () => undefined) {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const stored = initial;
  let read = false;
  let classAtWrite: string | undefined;
  const portTransport = fromDomPort(port1);
  const transport: Transport = {
    ...portTransport,
    post: (message) => {
      if (isSettingsUpdate(message)) classAtWrite = document.documentElement.className;
      portTransport.post(message);
    },
  };
  serveRpc(fromDomPort(port2), {
    procedures: {
      "settings.get": () => {
        read = true;
        return {
          autonomy: "suggest" as const,
          capabilities: {
            "catch-what-matters": true,
            declutter: true,
            organize: true,
            "save-documents": true,
          },
          notifications: true,
          ...stored,
        };
      },
      "settings.update": () => write(),
    },
    subscriptions: { "app.events": () => undefined },
  });
  const client = createRpcClient(transport);
  return {
    client,
    router: createAppRouter(
      { getWorkerClient: () => Promise.resolve(client) },
      { initialEntries: ["/settings"] },
    ),
    classAtWrite: () => classAtWrite,
    read: () => read,
  };
}

/** OS preference is light; the stub is shared by every read of the media query. */
function lightOS(): void {
  const query = {
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  vi.stubGlobal("matchMedia", () => query);
}

const darkRadio = (): HTMLElement =>
  screen.getAllByRole("radio", { name: "Dark" })[0] ?? document.body;

const openSettings = (fake: ReturnType<typeof fakeApp>) =>
  render(<App workerClient={fake.client} router={fake.router} />);

describe("theme timing", () => {
  // Guards: a theme choice that waits for the settings write before the root class is applied.
  it("applies the root dark class before settings.update leaves the renderer", async () => {
    lightOS();
    const fake = fakeApp({ theme: "system", locale: "en" });
    openSettings(fake);
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await waitFor(() => expect(fake.read()).toBe(true));

    fireEvent.click(darkRadio());

    expect(fake.classAtWrite()).toContain("dark");
  });

  // Guards: a failed write snapping the visible theme and control back to the old choice.
  it("keeps the visible dark choice when settings.update fails", async () => {
    lightOS();
    let settle: ((ok: boolean) => void) | undefined;
    const pendingWrite = () =>
      new Promise<undefined>((resolve, reject) => {
        settle = (ok) => (ok ? resolve(undefined) : reject(new Error("write failed")));
      });
    const fake = fakeApp({ theme: "system", locale: "en" }, pendingWrite);
    openSettings(fake);
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await waitFor(() => expect(fake.read()).toBe(true));

    fireEvent.click(darkRadio());
    await waitFor(() => expect(settle).toBeDefined());
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => {
      settle?.(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(darkRadio().getAttribute("aria-checked")).toBe("true");
  });
});
