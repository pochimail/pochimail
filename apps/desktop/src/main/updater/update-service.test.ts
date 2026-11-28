import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@pochimail/logger/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdatePreferences, type UpdatePrefs } from "./update-preferences.ts";
import { createUpdateService, type UpdateServiceDeps } from "./update-service.ts";

const logger = createLogger({ sink: { write: () => undefined } });
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A clock the test steps by hand: `tick` runs the callback that was scheduled. */
const manualTimer = () => {
  let next: { fn: () => void; ms: number } | undefined;
  const delays: number[] = [];
  return {
    timer: {
      set: (fn: () => void, ms: number) => {
        next = { fn, ms };
        delays.push(ms);
        return () => {
          next = undefined;
        };
      },
    },
    tick: () => next?.fn(),
    delays,
  };
};

const setup = (
  body: string | Error,
  options: Partial<UpdateServiceDeps> & { prefs?: UpdatePrefs } = {},
) => {
  const clock = manualTimer();
  const fetchVersionFile = vi.fn(async () =>
    body instanceof Error
      ? { ok: false as const, error: body }
      : { ok: true as const, value: body },
  );
  let saved: UpdatePrefs = options.prefs ?? { autoCheck: true, dismissedVersion: null };
  const service = createUpdateService({
    enabled: true,
    currentVersion: "1.0.0",
    fetchVersionFile,
    timer: clock.timer,
    preferences: {
      load: () => saved,
      save: (prefs) => {
        saved = prefs;
      },
    },
    logger,
    ...options,
  });
  return { service, fetchVersionFile, clock, saved: () => saved };
};
const file = (version: string) => JSON.stringify({ version });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("update service", () => {
  // Guards: a higher version on the Release not being announced, or being announced more than once.
  it("announces a newer version exactly once per launch", async () => {
    const { service, clock } = setup(file("1.2.0"));
    const changed = vi.fn();
    service.onChange(changed);
    service.start();
    expect(clock.delays).toEqual([15_000]);
    clock.tick();
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(service.takeAnnouncement()).toBe("1.2.0");
    expect(service.takeAnnouncement()).toBeNull();
    clock.tick();
    await flush();
    expect(service.takeAnnouncement()).toBeNull();
    expect(clock.delays.slice(1)).toEqual([86_400_000, 86_400_000]);
  });

  // Guards: noise for the person: same or lower versions, a missing or malformed file, or a network error showing a toast.
  it.each([
    ["the same version", file("1.0.0")],
    ["a lower version", file("0.9.9")],
    ["a pre-release suffix", file("2.0.0-beta.1")],
    ["a v prefix", file("v2.0.0")],
    ["a number instead of a string", '{"version":2}'],
    ["no version", "{}"],
    ["not JSON", "<html>404</html>"],
    ["a network error", new Error("offline")],
  ])("shows nothing for %s", async (_name, body) => {
    const { service, clock } = setup(body);
    service.start();
    clock.tick();
    await flush();
    expect(service.takeAnnouncement()).toBeNull();
    expect(service.state().latest).toBeNull();
  });

  // Guards: 1.10.0 sorting below 1.9.0 (string comparison) so a real update goes unannounced.
  it("compares versions as numbers", async () => {
    const { service } = setup(file("1.10.0"), { currentVersion: "1.9.0" });
    expect(await service.checkNow()).toEqual({ status: "available", version: "1.10.0" });
    const older = setup(file("1.9.0"), { currentVersion: "1.10.0" });
    expect(await older.service.checkNow()).toEqual({ status: "up-to-date" });
  });

  // Guards: dismissing hiding every later version, or not being remembered after a restart.
  it("remembers a dismissal for that version only, across launches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pochimail-updates-"));
    dirs.push(dir);
    const preferences = createUpdatePreferences(join(dir, "prefs.json"));
    const launch = async (version: string) => {
      const { service, clock } = setup(file(version), { preferences });
      service.start();
      clock.tick();
      await flush();
      return service;
    };
    const first = await launch("1.2.0");
    expect(first.takeAnnouncement()).toBe("1.2.0");
    first.dismiss("1.2.0");
    expect((await launch("1.2.0")).takeAnnouncement()).toBeNull();
    expect((await launch("1.3.0")).takeAnnouncement()).toBe("1.3.0");
  });

  // Guards: a dismissed version still being handed to a window that had not asked yet.
  it("drops a pending announcement that was dismissed", async () => {
    const { service, clock } = setup(file("1.2.0"));
    service.start();
    clock.tick();
    await flush();
    service.dismiss("1.2.0");
    expect(service.takeAnnouncement()).toBeNull();
    expect(service.state().latest).toBe("1.2.0");
  });

  // Guards: the automatic check running after it was switched off, or "Check now" refusing to run with it off.
  it("skips the automatic check when switched off but still answers Check now", async () => {
    const { service, clock, fetchVersionFile, saved } = setup(file("1.2.0"));
    service.setAutoCheck(false);
    await flush();
    expect(saved().autoCheck).toBe(false);
    service.start();
    clock.tick();
    await flush();
    expect(fetchVersionFile).not.toHaveBeenCalled();
    expect(await service.checkNow()).toEqual({ status: "available", version: "1.2.0" });
    expect(service.takeAnnouncement()).toBeNull();
  });

  // Guards: a build that must stay offline (dev, PR, smoke) contacting GitHub.
  it("never fetches when disabled", async () => {
    const { service, clock, fetchVersionFile } = setup(file("9.9.9"), { enabled: false });
    service.start();
    clock.tick();
    expect(await service.checkNow()).toEqual({ status: "disabled" });
    expect(clock.delays).toEqual([]);
    expect(fetchVersionFile).not.toHaveBeenCalled();
  });

  // Guards: a failed disk write crashing the app or a damaged preferences file blocking start.
  it("survives a preferences file that cannot be written or read", () => {
    const { service } = setup(file("1.0.0"), {
      preferences: {
        load: () => ({ autoCheck: true, dismissedVersion: null }),
        save: () => {
          throw new Error("disk full");
        },
      },
    });
    expect(() => service.setAutoCheck(false)).not.toThrow();
    const dir = mkdtempSync(join(tmpdir(), "pochimail-updates-"));
    dirs.push(dir);
    expect(createUpdatePreferences(join(dir, "missing.json")).load()).toEqual({
      autoCheck: true,
      dismissedVersion: null,
    });
  });
});
