import { describe, expect, it } from "vitest";
import { bundledManifest, manifestSchema, modelsForTier } from "./manifest.ts";

const sha = "a".repeat(64);
const commit = "b".repeat(40);
const entry = (url: string, overrides: Record<string, unknown> = {}) => ({
  id: "m",
  role: "embedding",
  tiers: ["T0"],
  license: "MIT",
  files: [{ name: "m.bin", url, bytes: 1, sha256: sha }],
  ...overrides,
});
const accepts = (model: unknown) => manifestSchema.safeParse({ models: [model] }).success;

describe("model manifest", () => {
  // Guards: a model URL off huggingface.co, unpinned, or on http reaching the downloader.
  it("accepts only https huggingface.co URLs pinned to a commit", () => {
    expect(accepts(entry(`https://huggingface.co/o/r/resolve/${commit}/m.bin`))).toBe(true);
    for (const url of [
      `https://example.com/o/r/resolve/${commit}/m.bin`,
      `http://huggingface.co/o/r/resolve/${commit}/m.bin`,
      `https://us.aws.cdn.hf.co/o/r/resolve/${commit}/m.bin`,
      "https://huggingface.co/o/r/resolve/main/m.bin",
      `https://huggingface.co/o/r/resolve/${commit}/m.bin?download=true`,
      `https://user@huggingface.co/o/r/resolve/${commit}/m.bin`,
      "not a url",
    ])
      expect(accepts(entry(url))).toBe(false);
  });

  // Guards: a file name that escapes the models folder, or a bad hash, passing validation.
  it("rejects path traversal and malformed hashes", () => {
    const url = `https://huggingface.co/o/r/resolve/${commit}/m.bin`;
    const file = { name: "m.bin", url, bytes: 1, sha256: sha };
    expect(accepts(entry(url, { files: [{ ...file, name: "../m.bin" }] }))).toBe(false);
    expect(accepts(entry(url, { files: [{ ...file, name: "/etc/m.bin" }] }))).toBe(false);
    expect(accepts(entry(url, { files: [{ ...file, sha256: "ABC" }] }))).toBe(false);
  });

  // Guards: a generative model being offered to T0 machines, or duplicate ids shadowing a model.
  it("keeps generative models off T0 and ids unique", () => {
    const url = `https://huggingface.co/o/r/resolve/${commit}/m.bin`;
    expect(accepts(entry(url, { role: "generative", tiers: ["T0", "T1"] }))).toBe(false);
    expect(manifestSchema.safeParse({ models: [entry(url), entry(url)] }).success).toBe(false);
  });

  // Guards: the bundled manifest drifting from ADR 0006 (models per tier).
  it("lists the ADR 0006 models per tier", () => {
    const ids = (tier: "T0" | "T1" | "T2") =>
      modelsForTier(bundledManifest, tier).map((model) => model.id);
    expect(ids("T0")).toEqual(["multilingual-e5-small"]);
    expect(ids("T1")).toEqual(["multilingual-e5-small", "qwen3.5-2b"]);
    expect(ids("T2")).toEqual(["multilingual-e5-small", "gemma-4-e4b-it"]);
  });
});
