import type { Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import type { Timer } from "@pochimail/pipeline/event-batching";
import type { CheckResult, UpdateState } from "../../shared/update-calls.ts";
import type { UpdatePreferences } from "./update-preferences.ts";
import { isNewer, parseLatestVersion } from "./version.ts";

export interface UpdateServiceDeps {
  /** False in dev, PR and smoke builds: the service then never calls `fetchVersionFile`. */
  enabled: boolean;
  currentVersion: string;
  /** The body of the latest Release's `latest.json`. */
  fetchVersionFile: () => Promise<Result<string, unknown>>;
  timer: Timer;
  preferences: UpdatePreferences;
  logger: Logger;
  /** First check shortly after launch, then about once a day. */
  initialDelayMs?: number;
  intervalMs?: number;
}

export interface UpdateService {
  start(): void;
  stop(): void;
  state(): UpdateState;
  /** A check the person asked for: runs even when the automatic check is off. */
  checkNow(): Promise<CheckResult>;
  setAutoCheck(enabled: boolean): void;
  dismiss(version: string): void;
  /** The version to put in a toast: handed out at most once per launch, and never a dismissed one. */
  takeAnnouncement(): string | null;
  /** Tells a window to ask for the announcement. Returns the way to stop listening. */
  onChange(listener: () => void): () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Looks for a newer version by reading a tiny version file from GitHub Releases. It only tells the person: nothing
 * downloads or installs (#300). A failed or malformed check is silent for the person and logged without detail.
 */
export const createUpdateService = (deps: UpdateServiceDeps): UpdateService => {
  const { enabled, currentVersion, timer, preferences, logger } = deps;
  let prefs = preferences.load();
  let latest: string | null = null;
  let pending: string | null = null;
  let announced = false;
  let inFlight: Promise<CheckResult> | undefined;
  let cancelNext: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const persist = (next: typeof prefs): void => {
    prefs = next;
    try {
      preferences.save(next);
    } catch {
      logger.warn("update preferences not saved");
    }
  };

  const isDismissed = (version: string): boolean =>
    prefs.dismissedVersion !== null && !isNewer(version, prefs.dismissedVersion);

  const found = (version: string, announce: boolean): void => {
    latest = version;
    if (!announce || announced || isDismissed(version)) return;
    pending = version;
    for (const listener of listeners) listener();
  };

  const run = async (announce: boolean): Promise<CheckResult> => {
    const fetched = await deps.fetchVersionFile();
    const version = fetched.ok ? parseLatestVersion(fetched.value) : undefined;
    if (version === undefined) {
      logger.warn("update check failed");
      return { status: "failed" };
    }
    if (!isNewer(version, currentVersion)) return { status: "up-to-date" };
    found(version, announce);
    return { status: "available", version };
  };

  const check = (announce: boolean): Promise<CheckResult> => {
    if (!enabled) return Promise.resolve({ status: "disabled" });
    inFlight ??= run(announce)
      .catch((): CheckResult => ({ status: "failed" }))
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  const schedule = (ms: number): void => {
    cancelNext = timer.set(() => {
      if (prefs.autoCheck) void check(true);
      schedule(deps.intervalMs ?? DAY_MS);
    }, ms);
  };

  return {
    start: () => {
      if (enabled && cancelNext === undefined) schedule(deps.initialDelayMs ?? 15_000);
    },
    stop: () => {
      cancelNext?.();
      cancelNext = undefined;
    },
    state: () => ({ enabled, currentVersion, autoCheck: prefs.autoCheck, latest }),
    checkNow: () => check(false),
    setAutoCheck: (value) => {
      persist({ ...prefs, autoCheck: value });
      if (value) void check(true);
    },
    dismiss: (version) => {
      if (prefs.dismissedVersion === null || isNewer(version, prefs.dismissedVersion))
        persist({ ...prefs, dismissedVersion: version });
      if (pending !== null && isDismissed(pending)) pending = null;
    },
    takeAnnouncement: () => {
      const version = pending;
      if (version === null) return null;
      pending = null;
      announced = true;
      return version;
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
