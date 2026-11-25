import type { StreamFetch } from "@pochimail/net/egress/model-download";

export interface FakeModelServerOptions {
  /** File bytes by URL path, e.g. `/owner/repo/resolve/<commit>/model.gguf`. Served on any host. */
  readonly files: Readonly<Record<string, Uint8Array>>;
  /** Origin requests are redirected to this host (with the same path) before the file is served. */
  readonly redirectHost?: string;
  /** Bytes per body chunk. */
  readonly chunkSize?: number;
  /** Each file response sends this many bytes, then the connection drops. Consumed in order. */
  readonly cutAfterBytes?: readonly number[];
  /** The first this many requests fail like a machine with no network. */
  readonly offlineRequests?: number;
  /** Answer every request with the whole file and status 200, as a server without Range support does. */
  readonly ignoreRange?: boolean;
}

export interface FakeModelServer {
  readonly fetch: StreamFetch;
  /** Hosts and first byte of each request that reached the server, in order. */
  requests(): readonly { readonly host: string; readonly rangeStart: number }[];
}

const abortError = () => new DOMException("The operation was aborted", "AbortError");

/** A fetch-level fake of Hugging Face: Range, redirect to a CDN host, cut connections, offline. */
export const createFakeModelServer = (options: FakeModelServerOptions): FakeModelServer => {
  const chunkSize = options.chunkSize ?? 64 * 1024;
  const cuts = [...(options.cutAfterBytes ?? [])];
  let offline = options.offlineRequests ?? 0;
  const seen: { host: string; rangeStart: number }[] = [];

  const fileResponse = (bytes: Uint8Array, rangeStart: number, signal: AbortSignal) => {
    const cutAfter = cuts.shift();
    const start = options.ignoreRange === true ? 0 : rangeStart;
    const ranged = start > 0;
    const limit = cutAfter === undefined ? bytes.length : Math.min(bytes.length, start + cutAfter);
    const body = (async function* () {
      for (let at = start; at < limit; at += chunkSize) {
        if (signal.aborted) throw abortError();
        yield bytes.subarray(at, Math.min(at + chunkSize, limit));
      }
      if (limit < bytes.length) throw new TypeError("terminated");
    })();
    return {
      status: ranged ? 206 : 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-range" && ranged
            ? `bytes ${start}-${bytes.length - 1}/${bytes.length}`
            : null,
      },
      body,
    };
  };

  return {
    requests: () => seen,
    fetch: async (rawUrl, init) => {
      const url = new URL(rawUrl);
      const rangeStart = Number(/^bytes=(\d+)-$/.exec(init.headers.range ?? "")?.[1] ?? 0);
      seen.push({ host: url.hostname, rangeStart });
      if (offline > 0) {
        offline -= 1;
        throw new TypeError("fetch failed");
      }
      if (options.redirectHost !== undefined && url.hostname !== options.redirectHost) {
        return {
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location"
                ? `https://${options.redirectHost}${url.pathname}?signature=fake`
                : null,
          },
          body: null,
        };
      }
      const bytes = options.files[url.pathname];
      if (bytes === undefined) return { status: 404, headers: { get: () => null }, body: null };
      if (rangeStart >= bytes.length && options.ignoreRange !== true)
        return { status: 416, headers: { get: () => null }, body: null };
      return fileResponse(bytes, rangeStart, init.signal);
    },
  };
};
