import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { type FileHandle, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { ModelFile } from "./manifest.ts";

export interface ModelTransportRequest {
  readonly url: string;
  /** First byte wanted; 0 asks for the whole file. */
  readonly rangeStart: number;
  readonly signal: AbortSignal;
}

export interface ModelTransportResponse {
  readonly status: number;
  readonly contentRange?: string;
  readonly body: AsyncIterable<Uint8Array>;
}

/** The network exit, injected. `blocked` is a refused host or redirect; `unreachable` is offline or stalled. */
export type ModelTransport = (
  request: ModelTransportRequest,
) => Promise<Result<ModelTransportResponse, "blocked" | "cancelled" | "unreachable">>;

export type DownloadFailure = "refused" | "cancelled" | "disk-full" | "hash-mismatch" | "failed";

export type FileState = "downloading" | "paused-offline" | "verifying";

export interface FileDownloadPorts {
  readonly transport: ModelTransport;
  readonly partialDir: string;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  /** `bytes` is what the file holds so far. */
  readonly report: (state: FileState, bytes: number) => void;
}

const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

export const sizeOf = async (path: string): Promise<number | undefined> => {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
};

const sha256Of = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
  return hash.digest("hex");
};

const rangeStartOf = (contentRange: string | undefined): number | undefined => {
  const match = /^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(contentRange ?? "");
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const failureOf = (error: unknown): DownloadFailure =>
  (error as NodeJS.ErrnoException | undefined)?.code === "ENOSPC" ? "disk-full" : "failed";

type Pull = Result<"progressed" | "interrupted" | "restart", DownloadFailure>;

/** Where the response body lands in the partial file, or what to do instead. */
const bodyStart = async (
  response: ModelTransportResponse,
  have: number,
  partial: string,
): Promise<Result<number | "restart", DownloadFailure>> => {
  if (response.status === 206)
    return rangeStartOf(response.contentRange) === have ? ok(have) : err("failed");
  if (response.status === 200) return ok(0); // The server ignored the range: start over.
  if (response.status === 416 && have > 0) {
    await rm(partial, { force: true });
    return ok("restart");
  }
  return err("failed");
};

/** Appends the body up to `file.bytes`. A cut stream ends quietly; the caller resumes from the file size. */
const writeBody = async (
  file: ModelFile,
  handle: FileHandle,
  body: AsyncIterable<Uint8Array>,
  from: number,
  ports: FileDownloadPorts,
  signal: AbortSignal,
): Promise<Result<number, DownloadFailure>> => {
  let offset = from;
  try {
    for await (const chunk of body) {
      const slice = chunk.subarray(0, file.bytes - offset);
      if (slice.length > 0) await handle.writeFile(slice);
      offset += slice.length;
      ports.report("downloading", offset);
      if (offset >= file.bytes) break;
    }
  } catch (error) {
    if (signal.aborted) return err("cancelled");
    if (failureOf(error) === "disk-full") return err("disk-full");
  }
  return ok(offset);
};

/** One request from byte `have` on, appended to the partial file. */
const pull = async (
  file: ModelFile,
  partial: string,
  have: number,
  ports: FileDownloadPorts,
  signal: AbortSignal,
): Promise<Pull> => {
  const response = await ports.transport({ url: file.url, rangeStart: have, signal });
  if (!response.ok) {
    if (response.error === "unreachable") return ok("interrupted");
    return err(response.error === "blocked" ? "refused" : "cancelled");
  }
  const start = await bodyStart(response.value, have, partial);
  if (!start.ok) return start;
  if (start.value === "restart") return ok("restart");
  const handle = await open(partial, start.value === 0 ? "w" : "a");
  try {
    const written = await writeBody(file, handle, response.value.body, start.value, ports, signal);
    if (!written.ok) return written;
    return ok(written.value > start.value ? "progressed" : "interrupted");
  } finally {
    await handle.close();
  }
};

/** Hashes the finished partial file; only a match is renamed into place, a mismatch is deleted. */
const verifyAndMove = async (
  file: ModelFile,
  partial: string,
  finalPath: string,
  ports: FileDownloadPorts,
): Promise<Result<void, DownloadFailure>> => {
  ports.report("verifying", file.bytes);
  if ((await sha256Of(partial)) !== file.sha256) {
    await rm(partial, { force: true });
    return err("hash-mismatch");
  }
  await mkdir(dirname(finalPath), { recursive: true });
  await rename(partial, finalPath);
  return ok(undefined);
};

/**
 * Fetches one manifest file into `finalPath`. The bytes live in `<partialDir>/<sha256>.part`, which
 * is kept for resume and renamed into place only after its SHA-256 equals the manifest's.
 * Network loss pauses with backoff and resumes by itself until cancelled.
 */
export const downloadFile = async (
  file: ModelFile,
  finalPath: string,
  ports: FileDownloadPorts,
  signal: AbortSignal,
): Promise<Result<void, DownloadFailure>> => {
  const partial = join(ports.partialDir, `${file.sha256}.part`);
  let delay = FIRST_DELAY_MS;
  try {
    await mkdir(ports.partialDir, { recursive: true });
    for (;;) {
      if (signal.aborted) return err("cancelled");
      const have = (await sizeOf(partial)) ?? 0;
      if (have === file.bytes) return await verifyAndMove(file, partial, finalPath, ports);
      if (have > file.bytes) {
        await rm(partial, { force: true });
        continue;
      }
      const pulled = await pull(file, partial, have, ports, signal);
      if (!pulled.ok) return pulled;
      if (pulled.value === "progressed") delay = FIRST_DELAY_MS;
      if (pulled.value === "interrupted") {
        ports.report("paused-offline", have);
        await ports.wait(delay, signal);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    }
  } catch (error) {
    return err(failureOf(error));
  }
};
