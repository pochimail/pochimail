import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  // Each test starts its own app with its own profile; one at a time keeps CI machines from skewing paced scans.
  workers: 1,
  // A flaky test is a bug to fix (waits are on events, never on time), not a retry to add.
  retries: 0,
  timeout: 60_000,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  expect: {
    // The bound for an event that must come (a window shown, a scan finished): it is a ceiling, never a pause.
    timeout: 15_000,
    toHaveScreenshot: {
      // Per-pixel colour distance (0 to 1, YIQ) under which two pixels are the same, and zero other differing pixels: a
      // one-pixel change of a spacing, radius or size token must fail. Raise only with a measured cause (ADR 0017).
      threshold: 0.1,
      maxDiffPixels: 0,
      animations: "disabled",
      caret: "hide",
    },
  },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  outputDir: "./test-results",
});
