import { describe, expect, it } from "vitest";
import { detectTier, type GpuKind, type HardwareReport } from "./tiers.ts";

const GIB = 1024 ** 3;
const SLOW = 3;
const FAST = 15;
const VERY_FAST = 50;

const report = (gib: number, overrides: Partial<HardwareReport> = {}): HardwareReport => ({
  totalMemoryBytes: gib * GIB,
  appleSilicon: false,
  gpu: "none",
  avx2: true,
  cpuTokensPerSecond: FAST,
  gpuTokensPerSecond: null,
  ...overrides,
});
const accelerated = (gpu: GpuKind, gpuTokensPerSecond: number) => ({ gpu, gpuTokensPerSecond });

describe("detectTier", () => {
  // Guards: a machine being given a model it cannot run, or denied one it can (ADR 0006, 0019 thresholds).
  it.each([
    ["4 GB", report(4), "T0"],
    ["4 GB with CUDA", report(4, accelerated("cuda", 100)), "T0"],
    ["8 GB, CPU only", report(8), "T0"],
    ["16 GB, CPU only, AVX2, fast", report(16), "T1"],
    ["a 16 GB machine reporting 15.5 GiB", report(15.5), "T1"],
    ["32 GB, CPU only, AVX2, fast", report(32), "T1"],
    ["16 GB, CPU only, no AVX2", report(16, { avx2: false }), "T0"],
    ["16 GB, CPU only, AVX2 unknown, fast", report(16, { avx2: null }), "T1"],
    ["16 GB, CPU only, AVX2, slow", report(16, { cpuTokensPerSecond: SLOW }), "T0"],
    ["16 GB, CPU only, not measured", report(16, { cpuTokensPerSecond: null }), "T0"],
    ["16 GB, CPU only, very fast", report(16, { cpuTokensPerSecond: VERY_FAST }), "T2"],
    ["8 GB with a weak iGPU, no faster than the CPU", report(8, accelerated("vulkan", FAST)), "T0"],
    [
      "16 GB with a weak iGPU, no faster than the CPU",
      report(16, accelerated("vulkan", FAST)),
      "T1",
    ],
    ["8 GB with a GPU 3x the CPU", report(8, accelerated("vulkan", FAST * 3)), "T1"],
    ["16 GB with a GPU reported but not measured", report(16, { gpu: "cuda" }), "T1"],
    ["16 GB with CUDA, measured", report(16, accelerated("cuda", FAST * 4)), "T2"],
    ["15 GB with CUDA, measured", report(15, accelerated("cuda", FAST * 4)), "T1"],
    ["8 GB Apple Silicon", report(8, { appleSilicon: true, gpu: "metal" }), "T1"],
    ["16 GB Apple Silicon", report(16, { appleSilicon: true, gpu: "metal" }), "T2"],
    ["64 GB Apple Silicon", report(64, { appleSilicon: true, gpu: "metal" }), "T2"],
  ] as const)("%s is %s", (_name, hardware, tier) => {
    expect(detectTier(hardware)).toBe(tier);
  });
});
