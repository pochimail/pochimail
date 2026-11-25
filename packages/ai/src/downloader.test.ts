import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadFile,
  type FileDownloadPorts,
  type FileState,
  type ModelTransport,
  type ModelTransportResponse,
  sleep,
} from "./downloader.ts";

const failing = vi.hoisted(() => ({
  code: undefined as string | undefined,
  open: false,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (failing.open && String(args[0]).endsWith(".part")) throw new Error("open failed");
      const handle = await actual.open(...args);
      if (failing.code === undefined) return handle;
      const code = failing.code;
      return new Proxy(handle, {
        get: (target, key) => {
          if (key === "writeFile")
            return async () => {
              throw Object.assign(new Error("write failed"), { code });
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

const bytes = Uint8Array.from({ length: 1_000 }, (_unused, at) => (at * 13) % 251);
const file = {
  name: "m.bin",
  url: "https://huggingface.co/o/r/resolve/x/m.bin",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pochimail-downloader-"));
});
afterEach(async () => {
  failing.code = undefined;
  failing.open = false;
  await rm(dir, { recursive: true, force: true });
});

const bodyOf = (chunk: Uint8Array, onClose?: () => void): AsyncIterable<Uint8Array> => ({
  [Symbol.asyncIterator]: () => {
    let sent = false;
    return {
      next: async () => {
        if (sent) return { done: true as const, value: undefined };
        sent = true;
        return { done: false as const, value: chunk };
      },
      return: async () => {
        onClose?.();
        return { done: true as const, value: undefined };
      },
    };
  },
});

const run = (answers: ModelTransportResponse[]) => {
  const waits: number[] = [];
  const states: FileState[] = [];
  const transport: ModelTransport = async () => {
    const next = answers.shift();
    return next === undefined ? { ok: false, error: "unreachable" } : { ok: true, value: next };
  };
  const ports: FileDownloadPorts = {
    transport,
    partialDir: join(dir, ".partial"),
    wait: async (ms) => void waits.push(ms),
    report: (state) => void states.push(state),
  };
  const final = join(dir, "final.bin");
  return {
    waits,
    states,
    final,
    result: downloadFile(file, final, ports, new AbortController().signal),
  };
};

describe("downloadFile", () => {
  // Guards: a failing disk (EIO, EPERM, EDQUOT) being retried as if the network had dropped.
  it.each([
    ["EIO", "failed"],
    ["EPERM", "failed"],
    ["EBUSY", "failed"],
    ["ENOSPC", "disk-full"],
    ["EDQUOT", "disk-full"],
  ])("fails on a write error %s instead of pausing as offline", async (code, error) => {
    failing.code = code;
    const { result, waits, states } = run([{ status: 200, body: bodyOf(bytes) }]);
    expect(await result).toEqual({ ok: false, error });
    expect(waits).toEqual([]);
    expect(states).not.toContain("paused-offline");
  });

  // Guards: a busy or rate-limited server ending the download for good instead of backing off.
  it.each([429, 502, 503, 504])("backs off on HTTP %i and then finishes", async (status) => {
    const closed = vi.fn();
    const { result, waits, final } = run([
      { status, body: bodyOf(new Uint8Array(), closed) },
      { status: 200, body: bodyOf(bytes) },
    ]);
    expect(await result).toEqual({ ok: true, value: undefined });
    expect(waits).toEqual([2_000]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await readFile(final))).toEqual(bytes);
  });

  // Guards: a busy server's Retry-After being ignored, or one huge value parking the download for hours.
  it.each([
    ["seconds", "7", [7_000, 7_000]],
    ["an HTTP date", new Date(Date.now() + 20_000).toUTCString(), [15_000, 20_000]],
    ["a date in the past", "Wed, 21 Oct 2015 07:28:00 GMT", [0, 0]],
    ["a huge value", "86400", [300_000, 300_000]],
    ["garbage", "soon", [2_000, 2_000]],
  ] as const)("waits as Retry-After asks: %s", async (_name, retryAfter, [least, most]) => {
    const { result, waits } = run([
      { status: 429, retryAfter, body: bodyOf(new Uint8Array()) },
      { status: 200, body: bodyOf(bytes) },
    ]);
    expect(await result).toEqual({ ok: true, value: undefined });
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(least);
    expect(waits[0]).toBeLessThanOrEqual(most);
  });

  // Guards: a live response body left open when the partial file cannot be opened.
  it("closes the body when the partial file cannot be opened", async () => {
    failing.open = true;
    const closed = vi.fn();
    const { result } = run([{ status: 200, body: bodyOf(bytes, closed) }]);
    expect(await result).toEqual({ ok: false, error: "failed" });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  // Guards: an HTTP error leaving its response body open.
  it("closes the body of a response it will not read", async () => {
    const closed = vi.fn();
    const { result } = run([{ status: 404, body: bodyOf(new Uint8Array(), closed) }]);
    expect(await result).toEqual({ ok: false, error: "failed" });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  // Guards: a restart that re-fetches less than the partial held counting as progress and resetting the backoff.
  it("backs off when a restarted body is shorter than the partial it replaced", async () => {
    await mkdir(join(dir, ".partial"));
    await writeFile(join(dir, ".partial", `${file.sha256}.part`), bytes.subarray(0, 600));
    const { result, waits, states } = run([
      { status: 200, body: bodyOf(bytes.subarray(0, 300)) },
      { status: 200, body: bodyOf(bytes) },
    ]);
    expect(await result).toEqual({ ok: true, value: undefined });
    expect(states).toContain("paused-offline");
    expect(waits).toEqual([2_000]);
  });
});

describe("downloadFile partial files", () => {
  const partialPath = () => join(dir, ".partial", `${file.sha256}.part`);

  // Guards: a partial the server can no longer range over (416) looping or being appended to.
  it("drops the partial and starts over when the server answers 416", async () => {
    await mkdir(join(dir, ".partial"));
    await writeFile(partialPath(), bytes.subarray(0, 600));
    const { result, waits, final } = run([
      { status: 416, body: bodyOf(new Uint8Array()) },
      { status: 200, body: bodyOf(bytes) },
    ]);
    expect(await result).toEqual({ ok: true, value: undefined });
    expect(waits).toEqual([]);
    expect(new Uint8Array(await readFile(final))).toEqual(bytes);
  });

  // Guards: a partial longer than the file being resumed instead of discarded.
  it("discards a partial that is longer than the file", async () => {
    await mkdir(join(dir, ".partial"));
    await writeFile(partialPath(), new Uint8Array(bytes.length + 500));
    const { result, final } = run([{ status: 200, body: bodyOf(bytes) }]);
    expect(await result).toEqual({ ok: true, value: undefined });
    expect(new Uint8Array(await readFile(final))).toEqual(bytes);
  });

  // Guards: an unusable partial folder throwing out of the download instead of failing it.
  it("fails when the partial folder cannot be created", async () => {
    await writeFile(join(dir, ".partial"), "not a folder");
    const { result } = run([{ status: 200, body: bodyOf(bytes) }]);
    expect(await result).toEqual({ ok: false, error: "failed" });
  });
});

describe("sleep", () => {
  // Guards: a backoff that never ends, or one that a cancel does not cut short.
  it("waits out the delay, and ends early when the signal aborts meanwhile", async () => {
    await sleep(5, new AbortController().signal);
    const controller = new AbortController();
    const started = Date.now();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await waiting;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  // Guards: a cancelled download waiting out a backoff of up to a minute.
  it("returns at once on an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await sleep(60_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
