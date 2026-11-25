import { describe, expect, it } from "vitest";
import { detectTier, type GpuKind, type HardwareReport } from "./tiers.ts";

const GIB = 1024 ** 3;
const report = (gib: number, gpu: GpuKind, appleSilicon = false): HardwareReport => ({
  totalMemoryBytes: gib * GIB,
  appleSilicon,
  gpu,
});

describe("detectTier", () => {
  // Guards: a weak or CPU-only machine being given a model it cannot run (ADR 0006 thresholds).
  it.each([
    ["4 GB, no GPU", report(4, "none"), "T0"],
    ["4 GB with a GPU", report(4, "cuda"), "T0"],
    ["8 GB, no GPU", report(8, "none"), "T0"],
    ["8 GB with Vulkan", report(8, "vulkan"), "T1"],
    ["8 GB Apple Silicon", report(8, "metal", true), "T1"],
    ["16 GB Apple Silicon", report(16, "metal", true), "T2"],
    ["16 GB with CUDA", report(16, "cuda"), "T2"],
    ["15 GB with CUDA", report(15, "cuda"), "T1"],
    ["32 GB, CPU only", report(32, "none"), "T0"],
    ["64 GB with Metal", report(64, "metal", true), "T2"],
  ] as const)("%s is %s", (_name, hardware, tier) => {
    expect(detectTier(hardware)).toBe(tier);
  });
});
