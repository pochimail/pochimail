import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@pochimail/logger/logger";
import type { StreamFetch } from "@pochimail/net/egress/model-download";
import { describe, expect, it, vi } from "vitest";
import { RELEASES_URL, updateChannels, VERSION_FILE_URL } from "../../shared/update-calls.ts";
import type { IpcSender } from "../ipc-guard.ts";
import { startUpdates } from "./start-updates.ts";

const logger = createLogger({ sink: { write: () => undefined } });
const APP_PAGE = { senderFrame: { url: "file:///app/index.html" } };

const launch = (options: {
  releaseBuild: boolean;
  env?: { POCHIMAIL_SMOKE?: string };
  latest?: string;
}) => {
  const handlers = new Map<string, (event: IpcSender, ...args: unknown[]) => unknown>();
  const requested: string[] = [];
  const fetch: StreamFetch = async (url) => {
    requested.push(url);
    return {
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        yield new TextEncoder().encode(JSON.stringify({ version: options.latest ?? "9.0.0" }));
      })(),
    };
  };
  let tick: (() => void) | undefined;
  const openExternal = vi.fn(async () => undefined);
  const sent: string[] = [];
  startUpdates({
    ipc: { handle: (channel, listener) => void handlers.set(channel, listener) },
    openExternal,
    isAppUrl: (url) => url === "file:///app/index.html",
    releaseBuild: options.releaseBuild,
    env: options.env ?? {},
    currentVersion: "1.0.0",
    preferencesFile: join(tmpdir(), `pochimail-start-${Math.random()}.json`),
    windows: () => [{ webContents: { send: (channel) => void sent.push(channel) } }],
    timer: {
      set: (fn) => {
        tick = fn;
        return () => undefined;
      },
    },
    logger,
    fetch,
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(APP_PAGE, ...args);
  return { handlers, requested, openExternal, sent, call, tick: () => tick?.() };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("update notice wiring", () => {
  // Guards: dev, PR and smoke builds contacting GitHub, or a release build not checking at all.
  it("requests the version file only in a release build outside the smoke run", async () => {
    for (const quiet of [
      { releaseBuild: false },
      { releaseBuild: true, env: { POCHIMAIL_SMOKE: "1" } },
    ]) {
      const app = launch(quiet);
      app.tick();
      await app.call(updateChannels.checkNow);
      expect(app.requested).toEqual([]);
    }
    const release = launch({ releaseBuild: true });
    release.tick();
    await flush();
    expect(release.requested).toEqual([VERSION_FILE_URL]);
    expect(release.sent).toEqual([updateChannels.changed]);
    expect(release.call(updateChannels.announcement)).toBe("9.0.0");
  });

  // Guards: the Download button opening anything other than the releases page, whatever the page or the file says.
  it("opens exactly the releases URL and ignores any argument", async () => {
    const app = launch({ releaseBuild: true });
    await app.call(updateChannels.download, "https://evil.example");
    expect(app.openExternal).toHaveBeenCalledOnce();
    expect(app.openExternal).toHaveBeenCalledWith(RELEASES_URL);
  });

  // Guards: an injected frame or a malformed argument reaching the update service.
  it("refuses unknown frames and invalid arguments", () => {
    const app = launch({ releaseBuild: true });
    const handler = app.handlers.get(updateChannels.download);
    expect(() => handler?.({ senderFrame: { url: "https://evil.example" } })).toThrow(/refused/);
    expect(() => app.call(updateChannels.dismiss, "1.2.3; drop")).toThrow();
    expect(() => app.call(updateChannels.setAutoCheck, "yes")).toThrow();
  });

  // Guards: an updater coming back: v1 only notices new versions, nothing downloads or installs itself.
  it("ships no electron-updater and no publish feed", () => {
    const manifest = readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8");
    expect(manifest).not.toContain("electron-updater");
    expect(manifest).not.toMatch(/"publish"\s*:/);
    expect(manifest).not.toMatch(/latest[^"]*\.yml/);
  });
});
