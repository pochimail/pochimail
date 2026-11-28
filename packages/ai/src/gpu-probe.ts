import { err, ok, type Result } from "@pochimail/kernel/result";
import { z } from "zod";
import type { GpuKind } from "./tiers.ts";

/** Why the probe gave no answer. The only thing about a failure that may be logged (ADR 0014). */
const probeFailureReasonSchema = z.enum([
  "no-prebuilt-binary",
  "no-vulkan-loader",
  "driver-error",
  "virtual-display",
  "crash",
  "timeout",
  "unknown",
]);
export type ProbeFailureReason = z.infer<typeof probeFailureReasonSchema>;

export interface RuntimeFacts {
  readonly gpu: GpuKind;
  /** `null` when the CPU has no AVX2 notion (Arm) or the runtime does not say. */
  readonly avx2: boolean | null;
}

export type GpuProbe = () => Promise<Result<RuntimeFacts, ProbeFailureReason>>;

interface LlamaRuntime {
  getLlama(options: { build: "never"; progressLogs: false }): Promise<{
    readonly gpu: false | "metal" | "cuda" | "vulkan";
    readonly systemInfo: string;
    dispose(): Promise<void>;
  }>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** llama.cpp's own CPU flags line, e.g. `AVX = 1 | AVX2 = 1 | ...`: the ADR 0019 source for AVX2. */
export const avx2Of = (systemInfo: string): boolean | null => {
  const flag = /\bAVX2 = (\d)\b/.exec(systemInfo)?.[1];
  return flag === undefined ? null : flag === "1";
};

const reasonOf = (error: unknown): ProbeFailureReason => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/NoBinaryFound/i.test(text)) return "no-prebuilt-binary";
  if (/vulkan/i.test(text) && /load|loader|dlopen|not found|cannot open/i.test(text))
    return "no-vulkan-loader";
  if (/display|headless|remote desktop|rdp|wayland|x11/i.test(text)) return "virtual-display";
  if (/driver|cuda|nvidia|vk[A-Z]|device/i.test(text)) return "driver-error";
  return "unknown";
};

/**
 * Asks the generative runtime which accelerator it can use and what the CPU offers. A throw or a
 * wait past `timeoutMs` is a failed probe with a closed reason, never an exception. A crash or a
 * blocked process cannot be caught here: the caller marks the probe as started (see `hardware.ts`).
 */
export const probeGpu = async (
  load: () => Promise<LlamaRuntime> = () => import("node-llama-cpp"),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Result<RuntimeFacts, ProbeFailureReason>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Result<RuntimeFacts, ProbeFailureReason>>((resolve) => {
    timer = setTimeout(() => resolve(err("timeout")), timeoutMs);
  });
  const probe = (async (): Promise<Result<RuntimeFacts, ProbeFailureReason>> => {
    try {
      const llama = await (await load()).getLlama({ build: "never", progressLogs: false });
      const facts: RuntimeFacts = {
        gpu: llama.gpu === false ? "none" : llama.gpu,
        avx2: avx2Of(llama.systemInfo),
      };
      await llama.dispose();
      return ok(facts);
    } catch (error) {
      return err(reasonOf(error));
    }
  })();
  try {
    return await Promise.race([probe, timedOut]);
  } finally {
    clearTimeout(timer);
  }
};
