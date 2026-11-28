import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import type { HostAllowlist } from "./allowlist.ts";
import { follow, type StreamFetch } from "./model-download.ts";

/** `blocked`: host, scheme or redirect refused. `unreachable`: no answer, a bad status, or a body that is too large. */
export type VersionFileError = "blocked" | "unreachable";

/** The file is a few dozen bytes; anything bigger is not the file. */
const MAX_BYTES = 4096;

const readCapped = async (body: AsyncIterable<Uint8Array>): Promise<string | undefined> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * A plain GET of one small text file: no headers, no cookies, no identifiers. Every hop, the first and each redirect,
 * must be `https` on the allow-list without credentials, so a redirect to an unlisted host is refused. Logs hosts only.
 */
export const createVersionFileReader = (options: {
  readonly allowlist: HostAllowlist;
  readonly fetch?: StreamFetch;
  readonly logger?: Logger;
  readonly timeoutMs?: number;
}): ((url: string) => Promise<Result<string, VersionFileError>>) => {
  const transport = options.fetch ?? (globalThis.fetch as StreamFetch);
  const timeoutMs = options.timeoutMs ?? 10_000;

  return async (rawUrl) => {
    let start: URL;
    try {
      start = new URL(rawUrl);
    } catch {
      return err("blocked");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const followed = await follow(
        start,
        (url) =>
          transport(url.href, { signal: controller.signal, redirect: "manual", headers: {} }),
        options.allowlist,
        options.logger,
      );
      if (!followed.ok) return followed;
      const { status, body } = followed.value;
      if (status !== 200 || body === null) {
        void Promise.resolve(body?.[Symbol.asyncIterator]().return?.()).catch(() => undefined);
        return err("unreachable");
      }
      const text = await readCapped(body);
      return text === undefined ? err("unreachable") : ok(text);
    } catch {
      return err("unreachable");
    } finally {
      clearTimeout(timer);
    }
  };
};
