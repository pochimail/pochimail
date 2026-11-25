import { windowActivityContract } from "@pochimail/testing/window-activity-contract";
import { describe, expect, it } from "vitest";
import { createWindowActivity } from "./window-activity-adapter.ts";

windowActivityContract(() => {
  const adapter = createWindowActivity();
  adapter.receive({ type: "window-activity", state: "focused" });
  return {
    activity: adapter,
    change: (state) => adapter.receive({ type: "window-activity", state }),
  };
});

describe("the worker's window activity", () => {
  it("drops a malformed or unknown message without changing state or throwing", () => {
    // Guards: a bad message from the channel crashing the worker or moving the polling cadence.
    const adapter = createWindowActivity();
    const seen: string[] = [];
    adapter.onChange((state) => void seen.push(state));
    for (const bad of [
      undefined,
      null,
      "hidden",
      42,
      { type: "window-activity" },
      { type: "window-activity", state: "asleep" },
      { type: "window-activitY", state: "hidden" },
      { state: "hidden" },
    ])
      expect(() => adapter.receive(bad)).not.toThrow();
    expect(adapter.current()).toBe("visible");
    expect(seen).toEqual([]);
  });
});
