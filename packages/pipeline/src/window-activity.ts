import type { Unsubscribe } from "@pochimail/kernel/common";

/** How the main window presents to the user: the key window, on screen but idle, or hidden. */
export type WindowActivityState = "focused" | "visible" | "hidden";

/** Window activity as main reports it; adaptive polling follows it (ADR 0004). Reads are infallible. */
export interface WindowActivity {
  current(): WindowActivityState;
  onChange(listener: (state: WindowActivityState) => void): Unsubscribe;
}
