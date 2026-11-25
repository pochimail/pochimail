import { describe, expect, it } from "vitest";
import { probeGpu } from "./gpu-probe.ts";

const runtime = (gpu: false | "metal" | "cuda" | "vulkan") => async () => ({
  getLlama: async () => ({ gpu, dispose: async () => {} }),
});

describe("probeGpu", () => {
  // Guards: a missing or broken runtime crashing tier detection instead of meaning "no GPU".
  it("reports the accelerator the runtime found and none otherwise", async () => {
    expect(await probeGpu(runtime("cuda"))).toBe("cuda");
    expect(await probeGpu(runtime("metal"))).toBe("metal");
    expect(await probeGpu(runtime(false))).toBe("none");
    expect(
      await probeGpu(async () => {
        throw new Error("no binary");
      }),
    ).toBe("none");
  });
});
