import { z } from "zod";

export const tierSchema = z.enum(["T0", "T1", "T2"]);
export type Tier = z.infer<typeof tierSchema>;

export const gpuKindSchema = z.enum(["metal", "cuda", "vulkan", "none"]);
export type GpuKind = z.infer<typeof gpuKindSchema>;

export const hardwareReportSchema = z.object({
  totalMemoryBytes: z.number().int().nonnegative(),
  appleSilicon: z.boolean(),
  /** What the runtime says it can use; it counts only if `gpuTokensPerSecond` shows it is faster. */
  gpu: gpuKindSchema,
  /** `null`: unknown (Arm, or the probe failed). */
  avx2: z.boolean().nullable(),
  /** Measured decode speed of the T1 model on the CPU path and on the accelerator; `null`: not measured. */
  cpuTokensPerSecond: z.number().nonnegative().nullable(),
  gpuTokensPerSecond: z.number().nonnegative().nullable(),
});
export type HardwareReport = z.infer<typeof hardwareReportSchema>;

const GIB = 1024 ** 3;
const T2_MIN_MEMORY_BYTES = 16 * GIB;
const T1_MIN_MEMORY_BYTES = 8 * GIB;
/** A machine sold as 16 GB reports about 15.5 GiB, so the CPU-only floor sits just below. */
const CPU_ONLY_MIN_MEMORY_BYTES = 15 * GIB;
/** Provisional (ADR 0019): speeds of the T1 model, from the measurements in `packages/ai/bench/results/`. */
const CPU_T1_MIN_TOKENS_PER_SECOND = 8;
const CPU_T2_MIN_TOKENS_PER_SECOND = 30;
/** An accelerator must beat the CPU path by this factor to count. */
const ACCELERATOR_MIN_SPEEDUP = 1.5;

const accelerated = (report: HardwareReport): boolean =>
  report.appleSilicon ||
  (report.gpu !== "none" &&
    report.gpuTokensPerSecond !== null &&
    report.gpuTokensPerSecond >= (report.cpuTokensPerSecond ?? 0) * ACCELERATOR_MIN_SPEEDUP);

const cpuOnlyTier = (report: HardwareReport): Tier => {
  const speed = report.cpuTokensPerSecond;
  if (report.totalMemoryBytes < CPU_ONLY_MIN_MEMORY_BYTES || report.avx2 === false) return "T0";
  if (speed === null || speed < CPU_T1_MIN_TOKENS_PER_SECOND) return "T0";
  return speed >= CPU_T2_MIN_TOKENS_PER_SECOND ? "T2" : "T1";
};

/** ADR 0006 and 0019: memory sets the ceiling, measured speed decides whether an accelerator or the CPU earns it. */
export const detectTier = (report: HardwareReport): Tier => {
  if (report.totalMemoryBytes < T1_MIN_MEMORY_BYTES) return "T0";
  if (!accelerated(report)) return cpuOnlyTier(report);
  return report.totalMemoryBytes >= T2_MIN_MEMORY_BYTES ? "T2" : "T1";
};
