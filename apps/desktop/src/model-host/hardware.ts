import { createHash } from "node:crypto";
import { arch, cpus, platform, totalmem } from "node:os";
import { measureCpuTokensPerSecond } from "@pochimail/ai/cpu-benchmark";
import { type GpuProbe, type ProbeFailureReason, probeGpu } from "@pochimail/ai/gpu-probe";
import {
  detectTier,
  type HardwareReport,
  hardwareReportSchema,
  type Tier,
} from "@pochimail/ai/tiers";
import type { Logger } from "@pochimail/logger/logger";
import { z } from "zod";

const storedDetectionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("probing"), fingerprint: z.string() }),
  z.object({ state: z.literal("done"), fingerprint: z.string(), report: hardwareReportSchema }),
]);
type StoredDetection = z.infer<typeof storedDetectionSchema>;

/**
 * Remembers the last detection across launches. The caller decides where (#314); `load` may return
 * anything, it is validated here. A "probing" entry left behind means the process died in the probe.
 */
interface DetectionStore {
  load(): Promise<unknown>;
  save(detection: StoredDetection): Promise<void>;
}

export interface HardwareSources {
  readonly totalMemoryBytes: () => number;
  readonly platform: () => string;
  readonly arch: () => string;
  readonly probeGpu: GpuProbe;
  /** Estimated tokens per second of the T1 model on the CPU; rejects when it cannot be measured. */
  readonly measureCpu: () => Promise<number>;
  /** Changes when the hardware does; never logged. */
  readonly fingerprint: () => string;
}

interface DetectionEnv {
  readonly store: DetectionStore;
  readonly log: Logger;
}

const GIB = 1024 ** 3;

const machineFingerprint = (): string =>
  createHash("sha256")
    .update(
      [platform(), arch(), cpus()[0]?.model, cpus().length, Math.round(totalmem() / GIB)].join("|"),
    )
    .digest("hex");

const machine: HardwareSources = {
  totalMemoryBytes: totalmem,
  platform,
  arch,
  probeGpu,
  measureCpu: measureCpuTokensPerSecond,
  fingerprint: machineFingerprint,
};

/**
 * Probes the accelerator and times the CPU. The probe runs here, in the model host, so a native
 * crash or hang costs this process and not the worker (ADR 0002); a failure yields the CPU-only
 * report with its closed reason. No v1 backend measures an accelerator (ADR 0018), so only Apple
 * Silicon counts as one until a backend reports `gpuTokensPerSecond`.
 */
const measure = async (
  sources: HardwareSources,
  crashed: boolean,
): Promise<{ report: HardwareReport; failure: ProbeFailureReason | undefined }> => {
  const probe = crashed ? ({ ok: false, error: "crash" } as const) : await sources.probeGpu();
  const facts = probe.ok ? probe.value : { gpu: "none", avx2: null };
  const report = hardwareReportSchema.parse({
    totalMemoryBytes: sources.totalMemoryBytes(),
    appleSilicon: sources.platform() === "darwin" && sources.arch() === "arm64",
    gpu: facts.gpu,
    avx2: facts.avx2,
    cpuTokensPerSecond: await sources.measureCpu().catch(() => null),
    gpuTokensPerSecond: null,
  });
  return { report, failure: probe.ok ? undefined : probe.error };
};

/**
 * The tier of this machine (ADR 0006, 0019). Reuses the stored detection while the hardware
 * fingerprint is unchanged; `redetect` (the "re-detect" action, #314) measures again. A failed
 * probe logs its closed reason, the tier and the throughput, and nothing else.
 */
export const detectHostTier = async (
  { store, log }: DetectionEnv,
  options: { redetect?: boolean; sources?: HardwareSources } = {},
): Promise<Tier> => {
  const sources = options.sources ?? machine;
  const fingerprint = sources.fingerprint();
  const stored = storedDetectionSchema.safeParse(await store.load().catch(() => undefined));
  const previous =
    stored.success && stored.data.fingerprint === fingerprint ? stored.data : undefined;
  if (options.redetect !== true && previous?.state === "done") return detectTier(previous.report);

  await store.save({ state: "probing", fingerprint });
  const { report, failure } = await measure(
    sources,
    options.redetect !== true && previous?.state === "probing",
  );
  await store.save({ state: "done", fingerprint, report });
  const tier = detectTier(report);
  if (failure !== undefined)
    log.warn(
      `accelerator probe failed: ${failure}; tier ${tier}; ${report.cpuTokensPerSecond ?? "unmeasured"} tokens/s`,
    );
  return tier;
};
