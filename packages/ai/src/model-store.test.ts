import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFakeModelServer,
  type FakeModelServerOptions,
} from "@pochimail/testing/fake-model-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelTransport } from "./downloader.ts";
import { type ModelManifest, manifestSchema } from "./manifest.ts";
import { createModelStore, type DownloadProgress } from "./model-store.ts";

const commit = "c".repeat(40);
const bytesOf = (seed: number, length: number) =>
  Uint8Array.from({ length }, (_unused, at) => (at * 31 + seed) % 251);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const payloads = { weights: bytesOf(1, 300_000), tokenizer: bytesOf(2, 5_000) };
const manifest: ModelManifest = manifestSchema.parse({
  models: [
    {
      id: "tiny-model",
      role: "generative",
      tiers: ["T1"],
      license: "MIT",
      files: Object.entries(payloads).map(([name, bytes]) => ({
        name: `${name}.bin`,
        url: `https://huggingface.co/owner/repo/resolve/${commit}/${name}.bin`,
        bytes: bytes.length,
        sha256: sha256(bytes),
      })),
    },
  ],
});
const filesAt = (served: Record<string, Uint8Array> = payloads) =>
  Object.fromEntries(
    Object.entries(served).map(([name, bytes]) => [
      `/owner/repo/resolve/${commit}/${name}.bin`,
      bytes,
    ]),
  );

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pochimail-models-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const setup = (
  server: Partial<FakeModelServerOptions> = {},
  extra: { freeBytes?: number } = {},
) => {
  const fake = createFakeModelServer({ files: filesAt(), chunkSize: 16_384, ...server });
  const transport: ModelTransport = async ({ url, rangeStart, signal }) => {
    try {
      const response = await fake.fetch(url, {
        signal,
        redirect: "manual",
        headers: { range: `bytes=${rangeStart}-` },
      });
      if (response.body === null && response.status !== 200 && response.status !== 206)
        return { ok: true, value: { status: response.status, body: (async function* () {})() } };
      const contentRange = response.headers.get("content-range") ?? undefined;
      return {
        ok: true,
        value: {
          status: response.status,
          ...(contentRange === undefined ? {} : { contentRange }),
          body: response.body ?? (async function* () {})(),
        },
      };
    } catch {
      return { ok: false, error: signal.aborted ? "cancelled" : "unreachable" };
    }
  };
  const waits: number[] = [];
  const store = createModelStore({
    dir,
    manifest,
    transport,
    wait: async (ms) => void waits.push(ms),
    ...(extra.freeBytes === undefined ? {} : { freeBytes: async () => extra.freeBytes as number }),
  });
  return { store, fake, waits };
};

const modelFolder = () => readdir(join(dir, "tiny-model")).catch(() => []);
const partials = () => readdir(join(dir, ".partial")).catch(() => []);

describe("model store", () => {
  // Guards: a resumed download ending with different bytes than the manifest's, or not resuming at all.
  it("resumes a download cut at several points and ends with the manifest's hash", async () => {
    const { store, fake } = setup({ cutAfterBytes: [40_000, 100_000, 7, 150_000] });
    const events: DownloadProgress[] = [];
    expect(await store.resolve("T1")).toEqual({ status: "unavailable", reason: "not-downloaded" });

    const done = await store.download("T1", { onProgress: (event) => events.push(event) });
    expect(done).toEqual({ ok: true, value: undefined });

    const ready = await store.resolve("T1");
    if (ready.status !== "ready") throw new Error("expected ready");
    const [model] = ready.models;
    const files = new Map(model?.files.map((file) => [file.name, file.path]));
    expect(sha256(await readFile(files.get("weights.bin") as string))).toBe(
      sha256(payloads.weights),
    );
    expect(sha256(await readFile(files.get("tokenizer.bin") as string))).toBe(
      sha256(payloads.tokenizer),
    );
    const weightStarts = fake.requests().map((request) => request.rangeStart);
    expect(weightStarts.slice(0, 4)).toEqual([0, 40_000, 140_000, 140_007]);
    expect(await partials()).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      state: "verifying",
      receivedBytes: 305_000,
      totalBytes: 305_000,
    });
  });

  // Guards: a corrupted file reaching the models folder, or a bad partial being kept and re-used.
  it("never moves a corrupted file in, discards the partial and reports the hash mismatch", async () => {
    const corrupted = Uint8Array.from(payloads.weights);
    corrupted[1234] = (corrupted[1234] ?? 0) ^ 0xff;
    const { store } = setup({ files: filesAt({ ...payloads, weights: corrupted }) });

    expect(await store.download("T1")).toEqual({ ok: false, error: "hash-mismatch" });
    expect(await modelFolder()).toEqual([]);
    expect(await partials()).toEqual([]);
    expect(await store.resolve("T1")).toEqual({ status: "unavailable", reason: "hash-mismatch" });
  });

  // Guards: a truncated file being treated as complete, or a cancel losing the bytes already fetched.
  it("keeps a cancelled partial out of place, then resumes it from where it stopped", async () => {
    const { store, fake } = setup();
    const controller = new AbortController();
    const cancelled = await store.download("T1", {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.receivedBytes >= 50_000) controller.abort();
      },
    });
    expect(cancelled).toEqual({ ok: false, error: "cancelled" });
    expect(await modelFolder()).toEqual([]);
    expect((await partials()).length).toBe(1);
    expect(await store.resolve("T1")).toEqual({ status: "unavailable", reason: "not-downloaded" });

    expect((await store.download("T1")).ok).toBe(true);
    const second = fake.requests().at(-2);
    expect(second?.rangeStart).toBeGreaterThanOrEqual(50_000);
    expect((await store.resolve("T1")).status).toBe("ready");
  });

  // Guards: a server without Range support corrupting a resumed file by appending a full copy.
  it("restarts the file when the server ignores the Range header", async () => {
    const { store } = setup({ ignoreRange: true, cutAfterBytes: [60_000] });
    expect((await store.download("T1")).ok).toBe(true);
    expect((await store.resolve("T1")).status).toBe("ready");
  });

  // Guards: a no-network machine failing the download instead of pausing and resuming by itself.
  it("pauses while offline, resumes by itself and reports offline if cancelled meanwhile", async () => {
    const online = setup({ offlineRequests: 3 });
    expect((await online.store.download("T1")).ok).toBe(true);
    expect(online.waits).toEqual([2_000, 4_000, 8_000]);

    await rm(dir, { recursive: true, force: true });
    const stuck = setup({ offlineRequests: 99 });
    const controller = new AbortController();
    const result = await stuck.store.download("T1", {
      signal: controller.signal,
      onProgress: (event) => {
        if (event.state === "paused-offline") controller.abort();
      },
    });
    expect(result).toEqual({ ok: false, error: "cancelled" });
    expect(await stuck.store.resolve("T1")).toEqual({ status: "unavailable", reason: "offline" });
  });

  // Guards: starting a 5 GB download on a disk that cannot hold it.
  it("checks free space before any request", async () => {
    const { store, fake } = setup({}, { freeBytes: 1_000 });
    expect(await store.download("T1")).toEqual({ ok: false, error: "disk-full" });
    expect(fake.requests()).toEqual([]);
    expect(await store.resolve("T1")).toEqual({ status: "unavailable", reason: "disk-full" });
  });

  // Guards: a refused host or an HTTP error being retried forever or reported as success.
  it("fails on a refused host and on an HTTP error", async () => {
    const refusing = createModelStore({
      dir,
      manifest,
      transport: async () => ({ ok: false, error: "blocked" }),
    });
    expect(await refusing.download("T1")).toEqual({ ok: false, error: "refused" });
    const missing = setup({ files: {} });
    expect(await missing.store.download("T1")).toEqual({ ok: false, error: "failed" });
    expect(await modelFolder()).toEqual([]);
  });

  // Guards: a URL, path or file name leaking through progress events (ADR 0014).
  it("reports progress with the model id and bytes only", async () => {
    const { store } = setup({ cutAfterBytes: [30_000] });
    const events: DownloadProgress[] = [];
    await store.download("T1", { onProgress: (event) => events.push(event) });
    const text = JSON.stringify(events);
    for (const secret of ["huggingface", "weights", "tokenizer", dir, "http", ".bin"])
      expect(text).not.toContain(secret);
    expect(new Set(events.map((event) => event.modelId))).toEqual(new Set(["tiny-model"]));
  });
});
