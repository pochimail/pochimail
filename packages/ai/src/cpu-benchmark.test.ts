import { describe, expect, it } from "vitest";
import { measureCpuTokensPerSecond } from "./cpu-benchmark.ts";

describe("measureCpuTokensPerSecond", () => {
  // Guards: the benchmark running past its budget, or returning a figure that cannot rank a CPU.
  it("returns a positive speed within a few seconds", async () => {
    const started = Date.now();
    const speed = await measureCpuTokensPerSecond(100);
    expect(Number.isFinite(speed) && speed > 0).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
