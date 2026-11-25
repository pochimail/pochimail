import { test } from "@playwright/test";
import type { ColorScheme } from "./app.ts";

export const COLOR_SCHEMES: readonly ColorScheme[] = ["light", "dark"];

/** Baselines are taken on Linux only: the same fonts rasterise differently on each OS (ADR 0017). Other systems skip the picture tests. */
export const skipUnlessBaselineOs = (): void =>
  test.skip(process.platform !== "linux", "Baselines are Linux-only (ADR 0017).");
