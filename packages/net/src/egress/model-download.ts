import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import { canonicalHost, type HostAllowlist } from "./allowlist.ts";

/** The part of `fetch` that streaming needs. The real `fetch` satisfies it. */
export type StreamFetch = (
  url: string,
  init: {
    readonly signal: AbortSignal;
    readonly redirect: "manual";
    readonly headers: Readonly<Record<string, string>>;
  },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: AsyncIterable<Uint8Array> | null;
}>;

export interface ModelDownloadRequest {
  readonly url: string;
  /** First byte wanted; 0 asks for the whole file. */
  readonly rangeStart: number;
  readonly signal?: AbortSignal;
}

export interface ModelDownloadResponse {
  readonly status: number;
  readonly contentRange?: string;
  readonly body: AsyncIterable<Uint8Array>;
}

/** `blocked`: host, scheme, port or redirect refused. `unreachable`: the network failed or stalled. */
export type ModelDownloadError = "blocked" | "cancelled" | "unreachable";

export type ModelDownloader = (
  request: ModelDownloadRequest,
) => Promise<Result<ModelDownloadResponse, ModelDownloadError>>;

const MAX_REDIRECTS = 3;

const noBody = async function* (): AsyncGenerator<Uint8Array> {};

const allowedUrl = (url: URL, allowlist: HostAllowlist): boolean =>
  url.protocol === "https:" && url.username === "" && url.password === "" && allowlist.allows(url);

const watchIdle = async function* (
  body: AsyncIterable<Uint8Array>,
  idleMs: number,
  abort: () => void,
): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort();
          reject(new Error("Download stalled"));
        }, idleMs);
      });
      try {
        const next = await Promise.race([iterator.next(), stalled]);
        if (next.done === true) return;
        yield next.value;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  } finally {
    void iterator.return?.();
  }
};

type Hop = Awaited<ReturnType<StreamFetch>>;

const redirectTarget = (response: Hop, from: URL): URL | undefined => {
  try {
    const location = response.headers.get("location");
    return location === null ? undefined : new URL(location, from);
  } catch {
    return undefined;
  }
};

/** Follows redirects by hand: every hop must pass the allow-list, so none can leave the two hosts. */
const follow = async (
  start: URL,
  call: (url: URL) => Promise<Hop>,
  allowlist: HostAllowlist,
  logger: Logger | undefined,
): Promise<Result<Hop, "blocked">> => {
  let url = start;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    if (!allowedUrl(url, allowlist)) {
      logger?.warn(`Model download blocked: ${canonicalHost(url.hostname)}`);
      return err("blocked");
    }
    const response = await call(url);
    if (response.status < 300 || response.status >= 400) return ok(response);
    const next = redirectTarget(response, url);
    if (next === undefined) return err("blocked");
    url = next;
  }
  return err("blocked");
};

const parseUrl = (raw: string): URL | undefined => {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
};

/** An abort controller that follows the caller's signal until `release` is called. */
const linkAbort = (signal: AbortSignal | undefined) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  return { controller, release: () => signal?.removeEventListener("abort", onAbort) };
};

const releasing = async function* (
  chunks: AsyncIterable<Uint8Array>,
  release: () => void,
): AsyncGenerator<Uint8Array> {
  try {
    yield* chunks;
  } finally {
    release();
  }
};

/**
 * Streams a file from the model hosts. Every hop, the first and each redirect, must be `https` on
 * the allow-list without credentials. A stalled body fails after `idleTimeoutMs`. Logs hosts only.
 */
export const createModelDownloader = (options: {
  readonly allowlist: HostAllowlist;
  readonly fetch?: StreamFetch;
  readonly logger?: Logger;
  readonly idleTimeoutMs?: number;
}): ModelDownloader => {
  const transport = options.fetch ?? (globalThis.fetch as StreamFetch);
  const idleMs = options.idleTimeoutMs ?? 30_000;

  return async (request) => {
    const start = parseUrl(request.url);
    if (start === undefined) return err("blocked");
    const cancelled = () => request.signal?.aborted === true;
    if (cancelled()) return err("cancelled");
    const { controller, release } = linkAbort(request.signal);
    const headers = { range: `bytes=${request.rangeStart}-` };

    const open = async (): Promise<Result<ModelDownloadResponse, "blocked">> => {
      const followed = await follow(
        start,
        (url) => transport(url.href, { signal: controller.signal, redirect: "manual", headers }),
        options.allowlist,
        options.logger,
      );
      if (!followed.ok) return followed;
      const { status, headers: received, body } = followed.value;
      const chunks = watchIdle(body ?? noBody(), idleMs, () => controller.abort());
      const contentRange = received.get("content-range") ?? undefined;
      return ok({
        status,
        ...(contentRange === undefined ? {} : { contentRange }),
        body: releasing(chunks, release),
      });
    };

    const result: Result<ModelDownloadResponse, ModelDownloadError> = await open().catch(() =>
      err(cancelled() ? "cancelled" : "unreachable"),
    );
    // A response keeps the abort link until its body ends; anything else lets go now.
    if (!result.ok) release();
    return result;
  };
};
