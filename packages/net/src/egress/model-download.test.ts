import { describe, expect, it } from "vitest";
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

  // Guards: a redirect that carries the request (and the Range) off the two model hosts.
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
  it("follows a redirect between the two hosts and streams the body", async () => {
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
    expect(models.hosts()).toEqual(["huggingface.co", "us.aws.cdn.hf.co"]);
    const mail = egressPolicy.create();
    expect(mail.allows("https://huggingface.co/x")).toBe(false);
    expect(mail.allows("https://us.aws.cdn.hf.co/x")).toBe(false);
    expect(models.allows("https://gmail.googleapis.com/x")).toBe(false);
  });
});
