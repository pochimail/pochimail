import { describe, expect, it, vi } from "vitest";
import { probeGpu } from "./gpu-probe.ts";

vi.mock("node-llama-cpp", () => ({
  getLlama: async () => ({ gpu: "vulkan", systemInfo: "", dispose: async () => {} }),
}));

const runtime =
  (gpu: false | "metal" | "cuda" | "vulkan", systemInfo = "") =>
  async () => ({
    getLlama: async () => ({ gpu, systemInfo, dispose: async () => {} }),
  });
const failing = (error: Error) => async () => {
  throw error;
};
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("probeGpu", () => {
  // Guards: the accelerator or AVX2 being misread, so a machine gets the wrong tier.
  it("reports the accelerator and AVX2 the runtime found", async () => {
    const avx = "AVX = 1 | AVX2 = 1 | FMA = 1 |";
    expect(await probeGpu(runtime("cuda", avx))).toEqual({
      ok: true,
      value: { gpu: "cuda", avx2: true },
    });
    expect(await probeGpu(runtime(false, "AVX = 1 | AVX2 = 0 |"))).toEqual({
      ok: true,
      value: { gpu: "none", avx2: false },
    });
    expect(await probeGpu(runtime("metal", "NEON = 1 | ARM_FMA = 1 |"))).toEqual({
      ok: true,
      value: { gpu: "metal", avx2: null },
    });
  });

  // Guards: a failed probe throwing, or leaking a device name or path through its reason.
  it.each([
    ["no binary", named("NoBinaryFoundError", "x"), "no-prebuilt-binary"],
    [
      "no loader",
      new Error("Failed to load libvulkan.so.1: cannot open shared object"),
      "no-vulkan-loader",
    ],
    ["a driver", new Error("CUDA driver version is insufficient"), "driver-error"],
    ["a remote session", new Error("cannot open display"), "virtual-display"],
    ["anything else", new Error("/Users/someone/secret.node exploded"), "unknown"],
  ] as const)("turns %s into a closed reason", async (_name, error, reason) => {
    expect(await probeGpu(failing(error))).toEqual({ ok: false, error: reason });
  });

  // Guards: a driver that never answers keeping tier detection waiting for ever.
  it("gives up after the timeout", async () => {
    const hang = async () => ({ getLlama: () => new Promise<never>(() => {}) });
    expect(await probeGpu(hang, 20)).toEqual({ ok: false, error: "timeout" });
  });

  // Guards: the production loader never reaching the llama binding.
  it("loads the real binding by default", async () => {
    expect(await probeGpu()).toEqual({ ok: true, value: { gpu: "vulkan", avx2: null } });
  });
});
