// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("Tailwind source coverage", () => {
  // Guards: shared components own utilities (segment states, radii, press states) that the desktop app
  // never writes in its own JSX. Without this source the app CSS lacks those rules while Storybook,
  // which scans packages/ui itself, still looks correct — the exact gap that hid the last UI regression.
  it("scans both the UI package and the desktop app", () => {
    expect(css).toMatch(/@source\s+"\.\.\/";/);
    expect(css).toContain('@source "../../../../apps/desktop/src";');
  });
});
