import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type ConsoleMessage,
  type ElectronApplication,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { E2E_OUT_DIR } from "#shared/gallery-build.ts";

export type ColorScheme = "light" | "dark";

export interface AppOptions {
  /** Start like a fresh install: no account until Connect. Default: the demo accounts are already connected. */
  readonly firstRun?: boolean;
  /** Each provider page takes this many ms, so a scan stays in progress long enough to watch. Default: no delay. */
  readonly scanPaceMs?: number;
  readonly colorScheme?: ColorScheme;
  /** Wait until the page is exactly `WINDOW` big. Needed for pictures; a small CI display (macOS, Windows) may not allow it. */
  readonly exactSize?: boolean;
}

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Uncaught errors, error-boundary reports and CSP violations of the renderer so far: a screen that throws shows up here. */
  readonly problems: readonly string[];
  /** Opens a route of the E2E build (the in-memory router starts at the URL hash): `/gallery`, `/settings`, … */
  open(route: string): Promise<void>;
  close(): Promise<void>;
}

/** What a console error means for the harness: a screen that failed to render, or a CSP block that leaves it unstyled. */
const problemIn = (message: ConsoleMessage): string | undefined => {
  if (message.type() !== "error") return undefined;
  // AppErrorBoundary logs this event when a screen fails to render.
  if (message.text().includes('"renderer-error"')) return `boundary: ${message.text()}`;
  // The strict CSP blocks a library that styles itself with an inline <style>: the screen then looks unstyled.
  if (message.text().includes("Content Security Policy")) return `csp: ${message.text()}`;
  return undefined;
};

/** The problems a page has logged so far, read from its own buffer: that includes what was logged before any listener existed. */
export async function loggedProblems(page: Page): Promise<string[]> {
  const logged = (await page.consoleMessages()).flatMap((message) => problemIn(message) ?? []);
  const thrown = (await page.pageErrors()).map((error) => `uncaught: ${error.message}`);
  return [...logged, ...thrown];
}

/** The window content size every test (and every baseline) is taken at. */
export const WINDOW = { width: 1100, height: 760 } as const;

export const appRoot = resolve(import.meta.dirname, "..");
const mainEntry = join(appRoot, E2E_OUT_DIR, "main", "index.js");

// Nothing from the developer's shell may point the window at a dev server, change how Electron starts or pick the demo.
const BLOCKED = /^(ELECTRON_RENDERER_URL|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|POCHIMAIL_)/;

const environment = (options: AppOptions): Record<string, string> => {
  const env: Record<string, string> = { TZ: "UTC", POCHIMAIL_DEMO: "small" };
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !BLOCKED.test(name) && name !== "TZ") env[name] = value;
  }
  if (options.firstRun === true) env.POCHIMAIL_DEMO_FIRST_RUN = "1";
  if (options.scanPaceMs !== undefined)
    env.POCHIMAIL_DEMO_SCAN_PACE_MS = String(options.scanPaceMs);
  return env;
};

/**
 * Starts the E2E build with the fixture-backed worker (no account, no network). The renderer keeps the app's own
 * hardening: this harness passes no window or web preference, so Node stays out of the page. Linux CI runs under
 * xvfb and has no setuid chrome-sandbox helper, hence --no-sandbox there only (packaging/smoke.ts does the same).
 */
export async function launchApp(options: AppOptions = {}): Promise<RunningApp> {
  const userData = mkdtempSync(join(tmpdir(), "pochimail-e2e-"));
  // Linux CI has no keychain, so main would ask how to protect the data first (ADR 0005). The demo keeps nothing, and the
  // prompt has its own tests: start as if "store without protection" was chosen already (storage-choice.ts).
  writeFileSync(join(userData, "storage-protection.json"), JSON.stringify({ mode: "unprotected" }));
  writeFileSync(join(userData, "db.key.plain"), "0".repeat(64));
  const app = await electron.launch({
    args: [
      mainEntry,
      `--user-data-dir=${userData}`,
      "--lang=en-US",
      ...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : []),
    ],
    env: environment(options),
  });
  const problems: string[] = [];
  const report = (problem: string) => {
    if (!problems.includes(problem)) problems.push(problem);
  };
  const watch = (window: Page) => {
    window.on("pageerror", (error) => report(`uncaught: ${error.message}`));
    window.on("console", (message) => {
      const problem = problemIn(message);
      if (problem !== undefined) report(problem);
    });
  };
  // Listening starts before the window exists, and what it logged while the bundle loaded is read back afterwards.
  app.on("window", watch);
  const page = await app.firstWindow();
  watch(page);
  for (const problem of await loggedProblems(page)) report(problem);
  // The window shows on ready-to-show; its size and the colour scheme are then fixed before anything is read from it.
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      new Promise<void>((done) => {
        const [window] = BrowserWindow.getAllWindows();
        if (window === undefined) throw new Error("no window");
        window.setContentSize(size.width, size.height);
        if (window.isVisible()) done();
        else window.once("show", () => done());
      }),
    WINDOW,
  );
  if (options.exactSize === true)
    await page.waitForFunction(
      (size) => innerWidth === size.width && innerHeight === size.height,
      WINDOW,
    );
  await page.emulateMedia({ colorScheme: options.colorScheme ?? "light", reducedMotion: "reduce" });
  const base = page.url().split("#")[0] ?? page.url();
  return {
    app,
    page,
    problems,
    open: async (route) => {
      await page.goto(`${base}#${route}`);
      await page.reload();
    },
    close: async () => {
      try {
        await app.close();
      } finally {
        rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}
