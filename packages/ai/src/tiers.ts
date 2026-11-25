import { z } from "zod";

export const tierSchema = z.enum(["T0", "T1", "T2"]);
export type Tier = z.infer<typeof tierSchema>;

export const gpuKindSchema = z.enum(["metal", "cuda", "vulkan", "none"]);
export type GpuKind = z.infer<typeof gpuKindSchema>;

export const hardwareReportSchema = z.object({
  totalMemoryBytes: z.number().int().nonnegative(),
  appleSilicon: z.boolean(),
  gpu: gpuKindSchema,
});
export type HardwareReport = z.infer<typeof hardwareReportSchema>;

const GIB = 1024 ** 3;
/** ADR 0006: T2 from 16 GB, T1 from 8 GB. Provisional until x64 CPU numbers exist. */
const T2_MIN_MEMORY_BYTES = 16 * GIB;
const T1_MIN_MEMORY_BYTES = 8 * GIB;

/** ADR 0006: T0 is under 8 GB or no usable GPU. RAM alone never lifts a CPU-only machine above T0. */
export const detectTier = (report: HardwareReport): Tier => {
  const accelerated = report.appleSilicon || report.gpu !== "none";
  if (!accelerated || report.totalMemoryBytes < T1_MIN_MEMORY_BYTES) return "T0";
  return report.totalMemoryBytes >= T2_MIN_MEMORY_BYTES ? "T2" : "T1";
};
