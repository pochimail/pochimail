import type { WindowActivity, WindowActivityState } from "@pochimail/pipeline/window-activity";

export interface FakeWindowActivity extends WindowActivity {
  /** Reports a new window state and tells listeners if it changed. */
  set(state: WindowActivityState): void;
}

export function createFakeWindowActivity(
  initial: WindowActivityState = "focused",
): FakeWindowActivity {
  let state = initial;
  const listeners = new Set<(state: WindowActivityState) => void>();
  return {
    current: () => state,
    onChange(listener) {
      const entry = (s: WindowActivityState) => listener(s);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    set(next) {
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener(state);
    },
  };
}
