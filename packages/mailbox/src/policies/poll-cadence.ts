/**
 * The adaptive polling cadence of ADR 0004: about 1 min while the window is focused, 5 min while
 * it is visible and idle. The hidden interval is the Keep it tidy cadence, which the app supplies
 * from settings when it wires the poller.
 */
export const FOCUSED_POLL_MS = 60_000;
export const VISIBLE_POLL_MS = 300_000;
