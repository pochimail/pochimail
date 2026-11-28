import { defineConfig } from "vitest/config";
import floors from "./tooling/ci/coverage-floors.json" with { type: "json" };

// One run over every package (`pnpm coverage`): contract and integration suites live in @pochimail/testing, so a package measured alone under-reports its adapters. Each package keeps its own vitest.config.ts as a project.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*", "tooling/*"],
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        "**/*.stories.*",
        "**/testing/**",
        "packages/testing/**",
      ],
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: floors,
    },
  },
});
