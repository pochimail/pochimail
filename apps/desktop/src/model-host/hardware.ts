import { arch, platform, totalmem } from "node:os";
import { type GpuProbe, probeGpu } from "@pochimail/ai/gpu-probe";
import {
  detectTier,
  type HardwareReport,
  hardwareReportSchema,
  type Tier,
} from "@pochimail/ai/tiers";

export interface HardwareSources {
  readonly totalMemoryBytes: () => number;
  readonly platform: () => string;
  readonly arch: () => string;
  readonly probeGpu: GpuProbe;
}

const machine: HardwareSources = { totalMemoryBytes: totalmem, platform, arch, probeGpu };

/** RAM, Apple Silicon and the accelerator the runtime can use, as one validated report. */
export const readHardwareReport = async (
  sources: HardwareSources = machine,
): Promise<HardwareReport> =>
  hardwareReportSchema.parse({
    totalMemoryBytes: sources.totalMemoryBytes(),
    appleSilicon: sources.platform() === "darwin" && sources.arch() === "arm64",
    gpu: await sources.probeGpu(),
  });

/** The tier of this machine (ADR 0006). The user can see it but not change it in v1. */
export const detectHostTier = async (sources?: HardwareSources): Promise<Tier> =>
  detectTier(await readHardwareReport(sources));
