import type { WindowActivityState } from "@pochimail/pipeline/window-activity";
import type { BrowserWindow } from "electron";
import type { WindowActivityMessage } from "../shared/window-activity-message.ts";

type WindowLike = Pick<BrowserWindow, "isFocused" | "isVisible" | "isMinimized" | "on" | "off">;

/** What the window is doing: hidden or minimized, in front and focused, or on screen but not the active window. */
export const windowActivityOf = (
  window: Pick<BrowserWindow, "isFocused" | "isVisible" | "isMinimized">,
): WindowActivityState => {
  if (!window.isVisible() || window.isMinimized()) return "hidden";
  return window.isFocused() ? "focused" : "visible";
};

const EVENTS = ["focus", "blur", "minimize", "restore", "show", "hide"] as const;

/**
 * Tells the worker what the window is doing: the current state now, then on every change, never twice in a row.
 * Calling it again for a new worker (a restart) sends that worker the current state first. Returns the stop.
 */
export const bridgeWindowActivityToWorker = (
  window: WindowLike,
  worker: { postMessage: (message: WindowActivityMessage) => void },
): (() => void) => {
  let sent: WindowActivityState | undefined;
  const send = () => {
    const state = windowActivityOf(window);
    if (state === sent) return;
    sent = state;
    worker.postMessage({ type: "window-activity", state });
  };
  send();
  for (const name of EVENTS) window.on(name as never, send);
  return () => {
    for (const name of EVENTS) window.off(name as never, send);
  };
};
