import { describe, expect, it, vi } from "vitest";
import { egressPolicy } from "./allowlist.ts";
import { createModelDownloader, type StreamFetch } from "./model-download.ts";

const respond = (status: number, location?: string): Awaited<ReturnType<StreamFetch>> => ({
  status,
  headers: { get: (name) => (name === "location" ? (location ?? null) : null) },
  body: (async function* () {
    yield new Uint8Array([1, 2, 3]);
  })(),
});

const download = (url: string, answers: Record<string, ReturnType<typeof respond>> = {}) => {
  const asked: string[] = [];
  const fetch: StreamFetch = async (requested) => {
    asked.push(requested);
    return answers[requested] ?? respond(200);
  };
  const run = createModelDownloader({ allowlist: egressPolicy.createForModelDownloads(), fetch });
  return { asked, result: run({ url, rangeStart: 0 }) };
};

const CDN_HOSTS = [
  "us.aws.cdn.hf.co",
  "us.gcp.cdn.hf.co",
  "cdn-lfs-us-1.hf.co",
  "cdn-lfs-eu-1.hf.co",
  "transfer.xethub.hf.co",
  "transfer.xethub-eu.hf.co",
];
const START = "https://huggingface.co/owner/repo/resolve/abc/model.gguf";

describe("model download egress", () => {
  // Guards: a model URL on any other host, scheme or port, or with credentials, leaving the machine.
  it.each([
    ["another host", "https://example.com/model.gguf"],
    ["plain http", "http://huggingface.co/owner/repo/resolve/abc/model.gguf"],
    ["a wildcard subdomain", "https://evil.huggingface.co/model.gguf"],
    ["a lookalike suffix", "https://nothuggingface.co/model.gguf"],
    ["another port", "https://huggingface.co:8443/model.gguf"],
    ["credentials", "https://user:pass@huggingface.co/model.gguf"],
    ["not a URL", "huggingface.co/model.gguf"],
  ])("refuses %s without calling the network", async (_name, url) => {
    const { asked, result } = download(url);
    expect(await result).toEqual({ ok: false, error: "blocked" });
    expect(asked).toEqual([]);
  });

  // Guards: a redirect that carries the request (and the Range) off the model hosts.
  it.each([
    ["a non-listed host", "https://evil.example/model.gguf"],
    ["plain http", "http://us.aws.cdn.hf.co/model.gguf"],
    ["a wildcard subdomain", "https://x.us.aws.cdn.hf.co/model.gguf"],
    ["credentials", "https://user@us.aws.cdn.hf.co/model.gguf"],
  ])("refuses a redirect to %s", async (_name, target) => {
    const start = "https://huggingface.co/owner/repo/resolve/abc/model.gguf";
    const { asked, result } = download(start, { [start]: respond(302, target) });
    expect(await result).toEqual({ ok: false, error: "blocked" });
    expect(asked).toEqual([start]);
  });

  // Guards: breaking the real huggingface.co → CDN hop, or following redirects forever.
  it("follows a redirect between model hosts and streams the body", async () => {
    const start = "https://huggingface.co/owner/repo/resolve/abc/model.gguf";
    const cdn = "https://us.aws.cdn.hf.co/blob/1?signature=fake";
    const { asked, result } = download(start, { [start]: respond(302, cdn) });
    const done = await result;
    expect(asked).toEqual([start, cdn]);
    if (!done.ok) throw new Error("expected a response");
    const chunks: Uint8Array[] = [];
    for await (const chunk of done.value.body) chunks.push(chunk);
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);

    const loop = download(start, { [start]: respond(302, start) });
    expect(await loop.result).toEqual({ ok: false, error: "blocked" });
  });

  // Guards: a dead network crashing the downloader instead of pausing it.
  it("reports a failed network as unreachable and a cancelled request as cancelled", async () => {
    const fetch: StreamFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const run = createModelDownloader({ allowlist: egressPolicy.createForModelDownloads(), fetch });
    const url = "https://huggingface.co/owner/repo/resolve/abc/model.gguf";
    expect(await run({ url, rangeStart: 0 })).toEqual({ ok: false, error: "unreachable" });
    const controller = new AbortController();
    controller.abort();
    expect(await run({ url, rangeStart: 0, signal: controller.signal })).toEqual({
      ok: false,
      error: "cancelled",
    });
  });

  // Guards: a connection that goes quiet hanging a download forever.
  it("fails a stalled body after the idle timeout", async () => {
    const fetch: StreamFetch = async (_url, init) => ({
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        await new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
        yield new Uint8Array();
      })(),
    });
    const run = createModelDownloader({
      allowlist: egressPolicy.createForModelDownloads(),
      fetch,
      idleTimeoutMs: 10,
    });
    const result = await run({
      url: "https://huggingface.co/owner/repo/resolve/abc/model.gguf",
      rangeStart: 0,
    });
    if (!result.ok) throw new Error("expected a response");
    await expect(
      (async () => {
        for await (const _chunk of result.value.body);
      })(),
    ).rejects.toThrow();
  });

  // Guards: the model hosts leaking into the mail allow-list or the session filter.
  it("keeps the model hosts out of the static policy", () => {
    const models = egressPolicy.createForModelDownloads();
    expect(models.hosts()).toEqual(["huggingface.co", ...CDN_HOSTS]);
    const mail = egressPolicy.create();
    for (const host of models.hosts()) expect(mail.allows(`https://${host}/x`)).toBe(false);
    expect(models.allows("https://gmail.googleapis.com/x")).toBe(false);
  });

  // Guards: a host Hugging Face really redirects to being refused, or its look-alikes being let in.
  it.each(CDN_HOSTS)("follows a redirect to %s and only to that exact host", async (host) => {
    const target = `https://${host}/blob/1?signature=fake`;
    const allowed = download(START, { [START]: respond(302, target) });
    expect((await allowed.result).ok).toBe(true);
    expect(allowed.asked).toEqual([START, target]);

    for (const lookalike of [`https://x.${host}/b`, `https://${host}.evil.example/b`]) {
      const refused = download(START, { [START]: respond(302, lookalike) });
      expect(await refused.result).toEqual({ ok: false, error: "blocked" });
    }
  });

  // Guards: Hugging Face's relative 307 for small files being refused as a redirect off the hosts.
  it("follows a relative redirect on the same host", async () => {
    const { asked, result } = download(START, { [START]: respond(307, "/owner/repo/blob/small") });
    expect((await result).ok).toBe(true);
    expect(asked).toEqual([START, "https://huggingface.co/owner/repo/blob/small"]);
  });

  // Guards: a refused host failing without saying which host, so the allow-list gap cannot be found.
  it("logs the refused host and nothing else", async () => {
    const warn = vi.fn();
    const logger = { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn(), child: vi.fn() };
    const run = createModelDownloader({
      allowlist: egressPolicy.createForModelDownloads(),
      fetch: async () => respond(200),
      logger,
    });
    await run({ url: "https://cdn.example.org/model.gguf?token=secret", rangeStart: 0 });
    expect(warn).toHaveBeenCalledExactlyOnceWith("download blocked: cdn.example.org");
  });

  // Guards: redirect bodies and an unread body keeping connections and the abort link alive.
  it("closes redirect bodies and releases the abort link when an unread body is closed", async () => {
    const closed = vi.fn();
    const redirect = {
      ...respond(302, "https://us.aws.cdn.hf.co/blob/1"),
      body: {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true as const, value: undefined }),
          return: async () => {
            closed();
            return { done: true as const, value: undefined };
          },
        }),
      },
    };
    const run = createModelDownloader({
      allowlist: egressPolicy.createForModelDownloads(),
      fetch: async (url) => (url === START ? redirect : respond(200)),
    });
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const result = await run({ url: START, rangeStart: 0, signal: controller.signal });
    expect(closed).toHaveBeenCalledTimes(1);
    if (!result.ok) throw new Error("expected a response");
    expect(removed).not.toHaveBeenCalled();
    await result.value.body[Symbol.asyncIterator]().return?.();
    expect(removed).toHaveBeenCalledTimes(1);
  });
});
