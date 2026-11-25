import { describe, expect, it } from "vitest";
import { detectHostTier, type HardwareSources, readHardwareReport } from "./hardware.ts";

const GIB = 1024 ** 3;
const machine = (
  gib: number,
  options: { platform?: string; arch?: string; gpu?: "metal" | "cuda" | "vulkan" | "none" } = {},
): HardwareSources => ({
  totalMemoryBytes: () => gib * GIB,
  platform: () => options.platform ?? "linux",
  arch: () => options.arch ?? "x64",
  probeGpu: async () => options.gpu ?? "none",
});

describe("hardware tier", () => {
  // Guards: Apple Silicon not being recognised, or an Intel Mac being mistaken for it.
  it("reads Apple Silicon from the platform and architecture", async () => {
    const apple = await readHardwareReport(
      machine(16, { platform: "darwin", arch: "arm64", gpu: "metal" }),
    );
    expect(apple).toEqual({ totalMemoryBytes: 16 * GIB, appleSilicon: true, gpu: "metal" });
    const intel = await readHardwareReport(machine(16, { platform: "darwin", arch: "x64" }));
    expect(intel.appleSilicon).toBe(false);
  });

  // Guards: the tier ignoring one of RAM, Apple Silicon or the GPU report.
  it.each([
    ["4 GB, no GPU", machine(4), "T0"],
    ["8 GB with Vulkan", machine(8, { gpu: "vulkan" }), "T1"],
    ["16 GB Apple Silicon", machine(16, { platform: "darwin", arch: "arm64", gpu: "metal" }), "T2"],
    ["16 GB with CUDA", machine(16, { gpu: "cuda" }), "T2"],
    ["32 GB, CPU only", machine(32), "T0"],
  ] as const)("%s is %s", async (_name, sources, tier) => {
    expect(await detectHostTier(sources)).toBe(tier);
  });
});
