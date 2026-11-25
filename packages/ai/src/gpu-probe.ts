import type { GpuKind } from "./tiers.ts";

export type GpuProbe = () => Promise<GpuKind>;

interface LlamaRuntime {
  getLlama(options: { build: "never"; progressLogs: false }): Promise<{
    readonly gpu: false | "metal" | "cuda" | "vulkan";
    dispose(): Promise<void>;
  }>;
}

/** Asks the generative runtime which accelerator it can use; any failure means there is none. */
export const probeGpu = async (
  load: () => Promise<LlamaRuntime> = () => import("node-llama-cpp"),
): Promise<GpuKind> => {
  try {
    const llama = await (await load()).getLlama({ build: "never", progressLogs: false });
    const gpu = llama.gpu === false ? "none" : llama.gpu;
    await llama.dispose();
    return gpu;
  } catch {
    return "none";
  }
};
