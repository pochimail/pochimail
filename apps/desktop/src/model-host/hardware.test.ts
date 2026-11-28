import type { ProbeFailureReason, RuntimeFacts } from "@pochimail/ai/gpu-probe";
import type { HardwareReport } from "@pochimail/ai/tiers";
import { createLogger, type LogRecord } from "@pochimail/logger/logger";
import { describe, expect, it } from "vitest";
import { detectHostTier, type HardwareSources } from "./hardware.ts";

type Machine = ReturnType<typeof machine>;
const detect = (run: Machine, options: { redetect?: boolean } = {}) =>
  detectHostTier(run.env, { ...options, sources: run.sources });

const GIB = 1024 ** 3;
const FAST_CPU = 15;

interface Options {
  platform?: string;
  arch?: string;
  facts?: RuntimeFacts | ProbeFailureReason;
  probe?: HardwareSources["probeGpu"];
  cpu?: number | "fails";
  stored?: unknown;
}

const machine = (gib: number, options: Options = {}) => {
  const records: LogRecord[] = [];
  const saved: unknown[] = [];
  const facts = options.facts ?? { gpu: "none", avx2: true };
  const sources: HardwareSources = {
    totalMemoryBytes: () => gib * GIB,
    platform: () => options.platform ?? "linux",
    arch: () => options.arch ?? "x64",
    probeGpu:
      options.probe ??
      (async () =>
        typeof facts === "string" ? { ok: false, error: facts } : { ok: true, value: facts }),
    measureCpu: async () => {
      if (options.cpu === "fails") throw new Error("worker failed");
      return options.cpu ?? FAST_CPU;
    },
    fingerprint: () => "machine-a",
  };
  const env = {
    store: {
      load: async () => options.stored,
      save: async (detection: unknown) => void saved.push(detection),
    },
    log: createLogger({ sink: { write: (record) => void records.push(record) } }),
  };
  return { env, sources, records, saved };
};

describe("hardware tier", () => {
  // Guards: the tier ignoring RAM, Apple Silicon, or the CPU's measured speed.
  it.each([
    ["4 GB", machine(4), "T0"],
    ["16 GB, fast CPU, AVX2", machine(16), "T1"],
    ["16 GB, no AVX2", machine(16, { facts: { gpu: "none", avx2: false } }), "T0"],
    ["16 GB, CPU too slow", machine(16, { cpu: 0 }), "T0"],
    ["16 GB, CPU not measurable", machine(16, { cpu: "fails" }), "T0"],
    [
      "16 GB Apple Silicon",
      machine(16, { platform: "darwin", arch: "arm64", facts: { gpu: "metal", avx2: null } }),
      "T2",
    ],
  ] as const)("%s is %s", async (_name, run, tier) => {
    expect(await detect(run)).toBe(tier);
  });

  // Guards: a failed or killed probe taking tier detection down with it (hang and throw: see gpu-probe.test.ts).
  it.each([
    [
      "fails",
      machine(16, { probe: async () => ({ ok: false, error: "driver-error" }) }),
      "driver-error",
    ],
    [
      "was killed in an earlier launch",
      machine(16, { stored: { state: "probing", fingerprint: "machine-a" } }),
      "crash",
    ],
  ] as const)(
    "a probe that %s gives the CPU-only tier and logs why",
    async (_name, run, reason) => {
      expect(await detect(run)).toBe("T1");
      expect(run.records).toEqual([
        {
          level: "warn",
          message: `accelerator probe failed: ${reason}; tier T1; ${FAST_CPU} tokens/s`,
          fields: {},
        },
      ]);
    },
  );

  // Guards: the log carrying anything besides the reason, the tier and the throughput.
  it("logs nothing else about a failed probe", async () => {
    const run = machine(8, { facts: "no-prebuilt-binary", cpu: 12.5 });
    await detect(run);
    expect(run.records).toEqual([
      {
        level: "warn",
        message: "accelerator probe failed: no-prebuilt-binary; tier T0; 12.5 tokens/s",
        fields: {},
      },
    ]);
  });

  // Guards: detection re-running the probe on every launch, or never again after the hardware changed.
  it("reuses a stored detection until the hardware or the user asks again", async () => {
    const report: HardwareReport = {
      totalMemoryBytes: 4 * GIB,
      appleSilicon: false,
      gpu: "none",
      avx2: true,
      cpuTokensPerSecond: FAST_CPU,
      gpuTokensPerSecond: null,
    };
    const same = machine(32, { stored: { state: "done", fingerprint: "machine-a", report } });
    expect(await detect(same)).toBe("T0");
    expect(same.saved).toEqual([]);
    expect(await detect(same, { redetect: true })).toBe("T1");
    const changed = machine(32, { stored: { state: "done", fingerprint: "machine-b", report } });
    expect(await detect(changed)).toBe("T1");
  });

  // Guards: an unreadable stored detection blocking tier detection.
  it("measures again when the stored detection is unreadable", async () => {
    const run = machine(16, { stored: { state: "done", fingerprint: "machine-a", report: 3 } });
    expect(await detect(run)).toBe("T1");
    expect(run.saved).toHaveLength(2);
  });
});
