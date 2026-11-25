import { mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@pochimail/kernel/result";
import {
  type DownloadFailure,
  downloadFile,
  type FileState,
  type ModelTransport,
  sizeOf,
  sleep,
} from "./downloader.ts";
import { type ModelEntry, type ModelFile, type ModelManifest, modelsForTier } from "./manifest.ts";
import type { Tier } from "./tiers.ts";

export type UnavailableReason = "not-downloaded" | "hash-mismatch" | "disk-full" | "offline";

export interface ResolvedModel {
  readonly id: string;
  readonly role: ModelEntry["role"];
  readonly files: readonly { readonly name: string; readonly path: string }[];
}

export type ModelResolution =
  | { readonly status: "ready"; readonly models: readonly ResolvedModel[] }
  | { readonly status: "unavailable"; readonly reason: UnavailableReason };

/** Bytes only, plus the model id: no URL, path or file name. */
export interface DownloadProgress {
  readonly modelId: string;
  readonly state: FileState;
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

export interface ModelStore {
  /** The files to load for `tier`, or why they cannot be loaded. Never hashes: only verified files are moved in. */
  resolve(tier: Tier): Promise<ModelResolution>;
  /** Fetches what `tier` is missing. Cancelling keeps the partial files for the next call. */
  download(
    tier: Tier,
    options?: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (p: DownloadProgress) => void;
    },
  ): Promise<Result<void, DownloadFailure>>;
}

const freeBytesOf = async (dir: string): Promise<number> => {
  const info = await statfs(dir);
  return info.bavail * info.bsize;
};

/** Free space to leave on the disk after the models are in. */
const FREE_SPACE_MARGIN_BYTES = 500 * 1024 ** 2;

type Report = (state: FileState, bytes: number) => void;

/** The one running download of a file; `listeners` are the callers following its progress. */
interface Job {
  readonly done: Promise<Result<void, DownloadFailure>>;
  readonly listeners: Set<Report>;
}

interface Context {
  readonly dir: string;
  readonly partialDir: string;
  readonly manifest: ModelManifest;
  readonly transport: ModelTransport;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly freeBytes: (dir: string) => Promise<number>;
  readonly lastFailure: Map<string, UnavailableReason>;
  readonly jobs: Map<string, Job>;
}

const pathOf = (ctx: Context, model: ModelEntry, file: ModelFile) =>
  join(ctx.dir, model.id, file.name);

const isInstalled = async (ctx: Context, model: ModelEntry, file: ModelFile) =>
  (await sizeOf(pathOf(ctx, model, file))) === file.bytes;

const bytesToFetch = async (ctx: Context, models: readonly ModelEntry[]): Promise<number> => {
  let missing = 0;
  for (const model of models) {
    for (const file of model.files) {
      if (await isInstalled(ctx, model, file)) continue;
      const partial = (await sizeOf(join(ctx.partialDir, `${file.sha256}.part`))) ?? 0;
      missing += Math.max(file.bytes - partial, 0);
    }
  }
  return missing;
};

/** Failures worth telling the user about later; the rest read as "not downloaded". */
const reasonOf = (error: DownloadFailure, state: FileState): UnavailableReason | undefined => {
  if (error === "cancelled") return state === "paused-offline" ? "offline" : undefined;
  return error === "hash-mismatch" || error === "disk-full" ? error : undefined;
};

const cancelledBy = (signal: AbortSignal): Promise<"cancelled"> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve("cancelled");
    else signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
  });

/**
 * One job per file hash: a call that arrives while the file is downloading follows that job instead
 * of writing the same partial file. If the job is cancelled by its owner, the follower takes over.
 */
const fetchFile = async (
  ctx: Context,
  file: ModelFile,
  finalPath: string,
  report: Report,
  signal: AbortSignal,
): Promise<Result<void, DownloadFailure>> => {
  for (let running = ctx.jobs.get(file.sha256); running !== undefined; ) {
    running.listeners.add(report);
    const outcome = await Promise.race([running.done, cancelledBy(signal)]);
    running.listeners.delete(report);
    if (outcome === "cancelled") return err("cancelled");
    if (outcome.ok || outcome.error !== "cancelled") return outcome;
    running = ctx.jobs.get(file.sha256);
  }
  const listeners = new Set<Report>([report]);
  const done = downloadFile(
    file,
    finalPath,
    {
      transport: ctx.transport,
      partialDir: ctx.partialDir,
      wait: ctx.wait,
      report: (state, bytes) => {
        for (const listener of listeners) listener(state, bytes);
      },
    },
    signal,
  ).finally(() => ctx.jobs.delete(file.sha256));
  ctx.jobs.set(file.sha256, { done, listeners });
  return done;
};

const fetchModel = async (
  ctx: Context,
  model: ModelEntry,
  signal: AbortSignal,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
): Promise<Result<void, DownloadFailure>> => {
  const totalBytes = model.files.reduce((sum, file) => sum + file.bytes, 0);
  let state = "downloading" as FileState;
  let doneBytes = 0;
  for (const file of model.files) {
    if (!(await isInstalled(ctx, model, file))) {
      const done = await fetchFile(
        ctx,
        file,
        pathOf(ctx, model, file),
        (next, bytes) => {
          state = next;
          onProgress?.({ modelId: model.id, state, receivedBytes: doneBytes + bytes, totalBytes });
        },
        signal,
      );
      if (!done.ok) {
        const reason = reasonOf(done.error, state);
        if (reason !== undefined) ctx.lastFailure.set(model.id, reason);
        return done;
      }
    }
    doneBytes += file.bytes;
  }
  ctx.lastFailure.delete(model.id);
  return ok(undefined);
};

/** Models live in `<dir>/<model id>/<file name>`; unfinished downloads in `<dir>/.partial`. */
export const createModelStore = (options: {
  readonly dir: string;
  readonly manifest: ModelManifest;
  readonly transport: ModelTransport;
  readonly freeBytes?: (dir: string) => Promise<number>;
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): ModelStore => {
  const ctx: Context = {
    dir: options.dir,
    partialDir: join(options.dir, ".partial"),
    manifest: options.manifest,
    transport: options.transport,
    wait: options.wait ?? sleep,
    freeBytes: options.freeBytes ?? freeBytesOf,
    lastFailure: new Map(),
    jobs: new Map(),
  };

  return {
    async resolve(tier) {
      const models: ResolvedModel[] = [];
      for (const model of modelsForTier(ctx.manifest, tier)) {
        for (const file of model.files) {
          if (!(await isInstalled(ctx, model, file)))
            return {
              status: "unavailable",
              reason: ctx.lastFailure.get(model.id) ?? "not-downloaded",
            };
        }
        models.push({
          id: model.id,
          role: model.role,
          files: model.files.map((file) => ({ name: file.name, path: pathOf(ctx, model, file) })),
        });
      }
      return { status: "ready", models };
    },

    async download(tier, { signal = new AbortController().signal, onProgress } = {}) {
      const wanted = modelsForTier(ctx.manifest, tier);
      try {
        await mkdir(ctx.partialDir, { recursive: true });
        const missing = await bytesToFetch(ctx, wanted);
        if (missing > 0 && missing + FREE_SPACE_MARGIN_BYTES > (await ctx.freeBytes(ctx.dir))) {
          for (const model of wanted) ctx.lastFailure.set(model.id, "disk-full");
          return err("disk-full");
        }
        for (const model of wanted) {
          const fetched = await fetchModel(ctx, model, signal, onProgress);
          if (!fetched.ok) return fetched;
        }
        return ok(undefined);
      } catch {
        return err("failed");
      }
    },
  };
};
