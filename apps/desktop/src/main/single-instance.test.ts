import { describe, expect, it, vi } from "vitest";
import {
  type FocusableWindow,
  focusOrCreateWindow,
  holdSingleInstanceLock,
} from "./single-instance.ts";

const appWith = (lock: boolean) => {
  const listeners: Array<() => void> = [];
  return {
    listeners,
    app: {
      requestSingleInstanceLock: () => lock,
      quit: vi.fn(),
      on: (_event: "second-instance", listener: () => void) => listeners.push(listener),
    },
  };
};

const windowWith = (minimized: boolean) => {
  const calls: string[] = [];
  const window: FocusableWindow = {
    isMinimized: () => minimized,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
  return { calls, window };
};

describe("holdSingleInstanceLock", () => {
  // Guards: a second process starting a window, worker, tray or storage gate on the database the first one has open.
  it("quits and starts nothing when the lock is refused", () => {
    const { app, listeners } = appWith(false);
    const openOrFocus = vi.fn();
    expect(holdSingleInstanceLock(app, openOrFocus)).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(listeners).toHaveLength(0);
    expect(openOrFocus).not.toHaveBeenCalled();
  });

  // Guards: a second launch that does nothing, or one that kills the instance that holds the lock.
  it("keeps running and brings the window forward on a second launch", () => {
    const { app, listeners } = appWith(true);
    const openOrFocus = vi.fn();
    expect(holdSingleInstanceLock(app, openOrFocus)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    listeners[0]?.();
    expect(openOrFocus).toHaveBeenCalledOnce();
  });
});

describe("focusOrCreateWindow", () => {
  // Guards: a minimized window staying hidden after a second launch, or a second window beside the first.
  it.each([
    [true, ["restore", "show", "focus"]],
    [false, ["show", "focus"]],
  ])(
    "shows and focuses the existing window (minimized: %s) and creates none",
    (minimized, calls) => {
      const { window, calls: seen } = windowWith(minimized);
      const create = vi.fn();
      focusOrCreateWindow([window], create);
      expect(seen).toEqual(calls);
      expect(create).not.toHaveBeenCalled();
    },
  );

  // Guards: a launch while the app sits in the tray, or on macOS with no windows, doing nothing.
  it("creates a window when there is none", () => {
    const create = vi.fn();
    focusOrCreateWindow([], create);
    expect(create).toHaveBeenCalledOnce();
  });
});
