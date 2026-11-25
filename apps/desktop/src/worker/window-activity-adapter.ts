import type { WindowActivity, WindowActivityState } from "@pochimail/pipeline/window-activity";
import { parseWindowActivityMessage } from "../shared/window-activity-message.ts";

/**
 * The worker's `WindowActivity`, fed by the messages main sends. Until the first one arrives the window counts as
 * visible. A message that is not exactly the typed one is dropped and changes nothing.
 */
export const createWindowActivity = (): WindowActivity & {
  receive(data: unknown): void;
} => {
  let state: WindowActivityState = "visible";
  const listeners = new Set<(state: WindowActivityState) => void>();
  return {
    current: () => state,
    onChange(listener) {
      const entry = (next: WindowActivityState) => listener(next);
      listeners.add(entry);
      return () => void listeners.delete(entry);
    },
    receive(data) {
      const message = parseWindowActivityMessage(data);
      if (message === undefined || message.state === state) return;
      state = message.state;
      for (const listener of [...listeners]) listener(state);
    },
  };
};
