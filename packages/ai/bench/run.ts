// Usage: node packages/ai/bench/run.ts --task embed|llm|all [--models id,id] [--limit N] [--cpu-only] [--out file.json]
// Run from the repo root with the pinned Node. Models are downloaded into packages/ai/bench/.models (git-ignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getLlama } from "node-llama-cpp";
import { measureCpuTokensPerSecond } from "../src/cpu-benchmark.ts";
import { avx2Of } from "../src/gpu-probe.ts";
import { buildDataset } from "./dataset.ts";
import { benchGenerative } from "./llm.ts";
import { embeddingModels, generativeModels } from "./models.ts";

const { values } = parseArgs({
  options: {
    task: { type: "string", default: "all" },
    models: { type: "string" },
    limit: { type: "string" },
    "cpu-only": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const here = import.meta.dirname;
const modelsDir = join(here, ".models");
mkdirSync(modelsDir, { recursive: true });
const wanted = values.models?.split(",");
const pick = <T extends { id: string }>(all: T[]): T[] =>
  wanted ? all.filter((m) => wanted.includes(m.id)) : all;
const limit = values.limit ? Number(values.limit) : undefined;
const all = buildDataset();
// --limit takes an evenly spaced sample so every category and language stays represented.
const emails = limit ? all.filter((_, i) => i % Math.ceil(all.length / limit) === 0) : all;
const task = values.task ?? "all";

/** What the app's own probe sees on this machine, to set the tier thresholds against the real numbers. */
async function cpuProbe(): Promise<{ avx2: boolean | null; probeTokensPerSecond: number }> {
  const llama = await getLlama({ gpu: false, progressLogs: false });
  const avx2 = avx2Of(llama.systemInfo);
  await llama.dispose();
  return { avx2, probeTokensPerSecond: await measureCpuTokensPerSecond() };
}

const report: Record<string, unknown> = {
  date: new Date().toISOString().slice(0, 10),
  machine: {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    ramGb: Math.round(totalmem() / 2 ** 30),
  },
  cpuOnly: values["cpu-only"],
  cpuProbe: await cpuProbe(),
  emails: emails.length,
  embeddings: [] as unknown[],
  generative: [] as unknown[],
};

if (task === "embed" || task === "all") {
  const { benchEmbedding } = await import("./embed.ts"); // onnxruntime-node has no darwin-x64 binary
  for (const model of pick(embeddingModels)) {
    console.error(`embedding: ${model.id}`);
    (report.embeddings as unknown[]).push(await benchEmbedding(model, emails));
  }
}
if (task === "llm" || task === "all") {
  for (const model of pick(generativeModels)) {
    console.error(`generative: ${model.id}`);
    (report.generative as unknown[]).push(
      await benchGenerative(model, emails, { modelsDir, cpuOnly: values["cpu-only"] ?? false }),
    );
  }
}

const json = JSON.stringify(report, null, 2);
if (values.out) writeFileSync(values.out, `${json}\n`);
console.log(json);
