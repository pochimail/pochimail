import { describe, expect, it } from "vitest";
import { type Library, startLlama } from "./llama-runtime.ts";

const library = (failFirst = false) => {
  const calls: Array<{ gpu?: unknown }> = [];
  const getLlama = async (options: { gpu?: unknown }) => {
    calls.push(options);
    if (failFirst && calls.length === 1) throw new Error("no gpu");
    return {} as never;
  };
  return { calls, lib: { getLlama } as unknown as Library };
};

describe("startLlama", () => {
  // Guards: Linux and Windows picking a GPU backend (Vulkan or CUDA) that v1 does not ship or test (ADR 0006).
  it.each(["linux", "win32"] as const)("is CPU-only on %s", async (platform) => {
    const { calls, lib } = library();
    await startLlama(lib, platform);
    expect(calls).toEqual([expect.objectContaining({ gpu: false, build: "never" })]);
  });

  // Guards: a Mac whose Metal start fails ending without a model instead of using the CPU.
  it("tries Metal first on macOS and falls back to the CPU", async () => {
    const { calls, lib } = library(true);
    await startLlama(lib, "darwin");
    expect(calls.map((c) => c.gpu)).toEqual([undefined, false]);
  });
});
