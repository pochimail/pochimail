import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import type { WindowActivity, WindowActivityState } from "@pochimail/pipeline/window-activity";
import { expect } from "vitest";

export interface WindowActivityHarness {
  readonly activity: WindowActivity;
  /** Makes main report this window state. */
  change(state: WindowActivityState): void;
}

export const windowActivityChecks: readonly Check<WindowActivityHarness>[] = [
  check(
    "current reflects a change (guards polling at the wrong cadence for the window state)",
    async ({ activity, change }) => {
      change("hidden");
      expect(activity.current()).toBe("hidden");
      change("visible");
      expect(activity.current()).toBe("visible");
    },
  ),
  check(
    "listeners receive the new state (guards the cadence switching too late)",
    async ({ activity, change }) => {
      const seen: WindowActivityState[] = [];
      activity.onChange((s) => void seen.push(s));
      change("visible");
      expect(seen).toEqual(["visible"]);
    },
  ),
  check(
    "an unchanged state notifies no one (guards redundant cadence reschedules)",
    async ({ activity, change }) => {
      let calls = 0;
      activity.onChange(() => void calls++);
      change(activity.current());
      expect(calls).toBe(0);
    },
  ),
  check(
    "unsubscribe stops notifications and is harmless twice (guards leaked listeners)",
    async ({ activity, change }) => {
      let calls = 0;
      const stop = activity.onChange(() => void calls++);
      stop();
      stop();
      change("hidden");
      expect(calls).toBe(0);
    },
  ),
];

/** Contract for any `WindowActivity`. `make` returns a fresh, focused activity. */
export function windowActivityContract(
  make: () => WindowActivityHarness | Promise<WindowActivityHarness>,
): void {
  registerContract("WindowActivity contract", windowActivityChecks, make);
}
