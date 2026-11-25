export const DEMO_SEED = 20261117;
export type DemoScale = "small" | "full";

/**
 * Demo mode (dev and E2E only): `POCHIMAIL_DEMO=small|full` runs the app on the fixture mailbox with no real account.
 * Main passes the value to the worker and the model host and never in a packaged build. How `@pochimail/testing` ships
 * in a packaged build is still an open question for the maintainer; until it is answered this is the only way in.
 */
export const demoScale = (value: string | undefined): DemoScale | undefined =>
  value === "small" || value === "full" ? value : undefined;

/** `POCHIMAIL_DEMO_FIRST_RUN=1`: the demo starts with no connected account, so Welcome → Connect → Setup can be walked (E2E). */
export const demoFirstRun = (value: string | undefined): boolean => value === "1";

/** `POCHIMAIL_DEMO_SCAN_PACE_MS=<ms>`: the demo's mail provider answers one small page per `<ms>`, so a scan stays visibly in progress (E2E). */
export const demoScanPaceMs = (value: string | undefined): number | undefined => {
  const ms = Number(value);
  return Number.isInteger(ms) && ms > 0 ? ms : undefined;
};

/** Messages per page when the demo scan is paced: small enough that every page moves the numbers. */
export const DEMO_PACED_PAGE_SIZE = 20;

/** What main forwards to the worker and model host: the demo scale and each switch that is set and valid. Never used in a packaged app. */
export const demoSwitches = (
  demo: DemoScale | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => ({
  POCHIMAIL_DEMO: demo ?? "",
  ...(demo !== undefined && demoFirstRun(env.POCHIMAIL_DEMO_FIRST_RUN)
    ? { POCHIMAIL_DEMO_FIRST_RUN: "1" }
    : {}),
  ...(demo !== undefined && demoScanPaceMs(env.POCHIMAIL_DEMO_SCAN_PACE_MS) !== undefined
    ? { POCHIMAIL_DEMO_SCAN_PACE_MS: env.POCHIMAIL_DEMO_SCAN_PACE_MS ?? "" }
    : {}),
});
