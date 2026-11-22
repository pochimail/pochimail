// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Stored = {
  readonly theme: "system" | "light" | "dark";
  readonly locale: "en" | "fr" | "ja" | null;
};

/** A real RPC server behind the public App entry point: every selection goes through the typed contract. */
function fakeApp(initial: Stored) {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  let stored: Stored = initial;
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
        notifications: true,
        ...stored,
      }),
      "settings.update": (patch) => {
        updates.push(patch);
        stored = {
          theme: patch.theme ?? stored.theme,
          locale: "locale" in patch ? (patch.locale ?? null) : stored.locale,
        };
        return undefined;
      },
    },
    subscriptions: { "app.events": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const open = () =>
    createAppRouter(
      { getWorkerClient: () => Promise.resolve(client) },
      { initialEntries: ["/settings"] },
    );
  return { client, router: open(), open, updates, stored: () => stored };
}

/** Stubs the OS appearance with a change event, so "System" can be observed resuming OS changes. */
function osAppearance(initial: boolean) {
  let dark = initial;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return (next: boolean): void => {
    dark = next;
    for (const listener of listeners) listener();
  };
}

const openSettings = (fake: ReturnType<typeof fakeApp>) =>
  render(<App workerClient={fake.client} router={fake.router} />);

// The frame and Settings both render the same segmented choices; the Settings row is last in the DOM.
const chooseTheme = async (label: "System" | "Light" | "Dark") => {
  const choices = screen.getAllByRole("radio", { name: label });
  await userEvent.click(choices[choices.length - 1] ?? document.body);
};

describe("appearance controller", () => {
  // Guards: a theme choice that only changes local state, or a `.dark` class nobody writes.
  it("selecting Dark writes settings.update and adds the root dark class", async () => {
    osAppearance(false);
    const fake = fakeApp({ theme: "system", locale: "en" });
    openSettings(fake);
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await chooseTheme("Dark");

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(fake.updates).toContainEqual({ theme: "dark" });
    expect(fake.stored().theme).toBe("dark");
  });

  // Guards: a "System" choice that keeps following a stale OS value after the OS changes.
  it("System resumes OS changes after a fixed theme", async () => {
    const changeOS = osAppearance(false);
    const fake = fakeApp({ theme: "system", locale: "en" });
    openSettings(fake);
    await screen.findAllByRole("radio", { name: "System" });

    await chooseTheme("Dark");
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    changeOS(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await chooseTheme("System");
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    changeOS(false);
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  });

  // Guards: a mounted screen staying in the old language when the OS language changes.
  it("re-renders a mounted screen when the OS language changes", async () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    const fake = fakeApp({ theme: "system", locale: null });
    openSettings(fake);
    const heading = await screen.findByRole("heading", { level: 1, name: "Settings" });

    languages.mockReturnValue(["fr-FR"]);
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });
    expect(screen.getByRole("heading", { level: 1 })).toBe(heading);
    expect(heading.textContent).toBe("Réglages");
  });

  // Guards: compact frame controls that are reachable by mouse but not by keyboard or name.
  it("changes the frame theme with the keyboard and writes the choice", async () => {
    osAppearance(false);
    const fake = fakeApp({ theme: "system", locale: "en" });
    openSettings(fake);
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    const frameTheme = screen.getAllByRole("radio", { name: "Dark" })[0];
    expect(frameTheme).toBeDefined();
    frameTheme?.focus();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Dark");
    await userEvent.keyboard(" "); // Radios activate with Space (arrow keys move between them).

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(fake.updates).toContainEqual({ theme: "dark" });
  });

  // Guards: a language selection that changes the icon but never reaches the worker or the screen.
  it("selecting a language writes settings.update and re-renders the screen", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    const fake = fakeApp({ theme: "system", locale: null });
    openSettings(fake);
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    await userEvent.click(screen.getAllByRole("button", { name: "Language" })[0] ?? document.body);
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Français" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Réglages"),
    );
    expect(fake.updates).toContainEqual({ locale: "fr" });
    expect(fake.stored().locale).toBe("fr");
  });

  // Guards: an explicit English choice on a non-English OS reverting to the OS on remount (the saved default is not "never chosen").
  it("keeps an explicit English choice across provider remount on a non-English OS", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    const fake = fakeApp({ theme: "system", locale: null });
    const view = openSettings(fake);
    await screen.findByRole("heading", { level: 1, name: "Réglages" });

    await userEvent.click(screen.getAllByRole("button", { name: "Langue" })[0] ?? document.body);
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "English" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings"),
    );
    expect(fake.stored().locale).toBe("en");

    view.unmount();
    openSettings({ ...fake, router: fake.open() });

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings"),
    );
    expect(fake.stored().locale).toBe("en");
  });
});
