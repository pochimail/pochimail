import { describe, expect, it } from "vitest";
import { egressPolicy } from "./allowlist.ts";
import type { StreamFetch } from "./model-download.ts";
import { createVersionFileReader } from "./version-file.ts";

const FILE = "https://github.com/pochimail/pochimail/releases/latest/download/latest.json";
const ASSET =
  "https://release-assets.githubusercontent.com/github-production-release-asset/1/latest.json";

type Answer = { status: number; location?: string; body?: string };
const reply = ({ status, location, body = "" }: Answer): Awaited<ReturnType<StreamFetch>> => ({
  status,
  headers: { get: (name) => (name === "location" ? (location ?? null) : null) },
  body: (async function* () {
    yield new TextEncoder().encode(body);
  })(),
});

const read = (answers: Record<string, Answer>, url = FILE) => {
  const asked: { url: string; headers: Record<string, string>; redirect: string }[] = [];
  const fetch: StreamFetch = async (requested, init) => {
    asked.push({ url: requested, headers: { ...init.headers }, redirect: init.redirect });
    return reply(answers[requested] ?? { status: 404 });
  };
  const run = createVersionFileReader({ allowlist: egressPolicy.createForUpdateCheck(), fetch });
  return { asked, result: run(url) };
};

describe("update check egress", () => {
  // Guards: the update hosts leaking into the always-on list that the session filter and mail clients use.
  it("keeps the update hosts out of the static hosts, and exact", () => {
    expect(egressPolicy.staticHosts).not.toContain("github.com");
    expect(egressPolicy.create().allows(FILE)).toBe(false);
    const allowlist = egressPolicy.createForUpdateCheck();
    expect(allowlist.hosts()).toEqual(["github.com", "release-assets.githubusercontent.com"]);
    expect(allowlist.allows(FILE)).toBe(true);
    expect(allowlist.allows(ASSET)).toBe(true);
    expect(allowlist.allows("https://api.github.com/repos")).toBe(false);
    expect(allowlist.allows("https://evil.github.com/x")).toBe(false);
  });

  // Guards: the version request carrying headers or following a redirect on its own.
  it("follows the Release redirects by hand and sends no headers", async () => {
    const { asked, result } = read({
      [FILE]: {
        status: 302,
        location: "https://github.com/pochimail/pochimail/releases/download/v1.2.3/latest.json",
      },
      "https://github.com/pochimail/pochimail/releases/download/v1.2.3/latest.json": {
        status: 302,
        location: ASSET,
      },
      [ASSET]: { status: 200, body: '{"version":"1.2.3"}' },
    });
    expect(await result).toEqual({ ok: true, value: '{"version":"1.2.3"}' });
    expect(asked).toHaveLength(3);
    for (const call of asked) expect(call).toMatchObject({ headers: {}, redirect: "manual" });
  });

  // Guards: a redirect that carries the request off the two update hosts.
  it.each([
    ["an unlisted host", "https://evil.example/latest.json"],
    ["plain http", "http://github.com/latest.json"],
    ["a wildcard subdomain", "https://x.github.com/latest.json"],
    ["credentials", "https://user@github.com/latest.json"],
  ])("refuses a redirect to %s", async (_name, target) => {
    const { asked, result } = read({ [FILE]: { status: 302, location: target } });
    expect(await result).toEqual({ ok: false, error: "blocked" });
    expect(asked.map((call) => call.url)).toEqual([FILE]);
  });

  // Guards: a start URL on another host reaching the network at all.
  it("refuses a first URL that is not on the update hosts", async () => {
    const { asked, result } = read(
      {},
      "https://api.github.com/repos/pochimail/pochimail/releases/latest",
    );
    expect(await result).toEqual({ ok: false, error: "blocked" });
    expect(asked).toEqual([]);
  });

  // Guards: an error page or an oversized body being read as the version file.
  it("treats a missing file or a huge body as unreachable", async () => {
    expect(await read({ [FILE]: { status: 404 } }).result).toEqual({
      ok: false,
      error: "unreachable",
    });
    expect(await read({ [FILE]: { status: 200, body: "x".repeat(10_000) } }).result).toEqual({
      ok: false,
      error: "unreachable",
    });
  });
});
