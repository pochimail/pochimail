import { expect, it } from "vitest";
import { demoSwitches } from "./demo.ts";

// Guards: a packaged app (no demo scale) forwarding the first-run or pace switches to the worker, or a bad pace reaching it.
it("forwards no switch without a demo scale, and drops invalid paces", () => {
  const env = { POCHIMAIL_DEMO_FIRST_RUN: "1", POCHIMAIL_DEMO_SCAN_PACE_MS: "200" };
  expect(demoSwitches(undefined, env)).toEqual({ POCHIMAIL_DEMO: "" });
  expect(demoSwitches("small", env)).toEqual({
    POCHIMAIL_DEMO: "small",
    POCHIMAIL_DEMO_FIRST_RUN: "1",
    POCHIMAIL_DEMO_SCAN_PACE_MS: "200",
  });
  for (const pace of ["0", "-5", "1.5", "abc", ""])
    expect(demoSwitches("small", { POCHIMAIL_DEMO_SCAN_PACE_MS: pace })).toEqual({
      POCHIMAIL_DEMO: "small",
    });
});
