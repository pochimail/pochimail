import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { electronBinaryPath, isUniversalSlice } from "./apply-fuses.ts";
import { galleryLeaksIn } from "./gallery-check.ts";
import { sizeTable } from "./size-report.ts";
import { checkKeychainRestart, type StorageSmoke } from "./storage-check.ts";

const app = { appOutDir: "release/x", productFilename: "Pochimail", executableName: "pochimail" };

describe("fuse target", () => {
  // Guards: fuses flipped on the wrong file (or not at all) so the shipped binary keeps RunAsNode.
  it.each([
    ["darwin", join("release/x", "Pochimail.app", "Contents", "MacOS", "Pochimail")],
    ["win32", join("release/x", "Pochimail.exe")],
    ["linux", join("release/x", "pochimail")],
  ])("points at the Electron binary on %s", (platform, expected) => {
    expect(electronBinaryPath({ ...app, platform })).toBe(expected);
  });

  it("refuses an unknown platform instead of skipping the fuses silently", () => {
    expect(() => electronBinaryPath({ ...app, platform: "freebsd" })).toThrow(/Unsupported/);
  });

  // Guards: re-signing each universal slice differently, which makes the universal merge fail.
  it("recognises the per-arch slices of a universal macOS build", () => {
    expect(isUniversalSlice("release/mac-universal-x64-temp")).toBe(true);
    expect(isUniversalSlice("release/mac-universal-arm64-temp")).toBe(true);
    expect(isUniversalSlice("release/mac-universal")).toBe(false);
  });
});

describe("size report", () => {
  // Guards: a job summary that lists blockmaps or update metadata, or passes with no artifact at all.
  it("lists installers in megabytes and ignores metadata", () => {
    const table = sizeTable("macOS", [
      { name: "Pochimail-0.0.0-universal.dmg", bytes: 226_086_302 },
      { name: "Pochimail-0.0.0-universal.dmg.blockmap", bytes: 9 },
      { name: "latest-mac.yml", bytes: 9 },
    ]);
    expect(table).toContain("| Pochimail-0.0.0-universal.dmg | 215.6 MB |");
    expect(table).not.toContain("blockmap");
    expect(table).not.toContain("latest-mac");
  });

  it("fails when no installer was produced", () => {
    expect(() => sizeTable("Linux", [{ name: "builder-debug.yml", bytes: 1 }])).toThrow(
      /No installer/,
    );
  });
});

describe("gallery leak check", () => {
  // Builds a minimal asar: [4, headerPickleSize, payloadSize, jsonLength] + JSON header + file data.
  const asar = (files: Record<string, string>) => {
    let offset = 0;
    const entries = Object.entries(files).map(([path, content]) => {
      const node = { size: content.length, offset: String(offset) };
      offset += content.length;
      return [path, node] as const;
    });
    const tree: Record<string, unknown> = {};
    for (const [path, node] of entries) {
      const parts = path.split("/");
      let dir = tree;
      for (const part of parts.slice(0, -1)) {
        const next = (dir[part] as { files: Record<string, unknown> } | undefined) ?? { files: {} };
        dir[part] = next;
        dir = next.files;
      }
      dir[parts.at(-1) as string] = node;
    }
    const json = Buffer.from(JSON.stringify({ files: tree }));
    const header = Buffer.alloc(16);
    header.writeUInt32LE(4, 0);
    header.writeUInt32LE(json.length + 8, 4);
    header.writeUInt32LE(json.length + 4, 8);
    header.writeUInt32LE(json.length, 12);
    return Buffer.concat([header, json, Buffer.from(Object.values(files).join(""))]);
  };

  // Guards: a smoke check that misses a shipped gallery (chunk or route path), or flags the inert sources under src/ of a clean app.
  it("flags a gallery chunk or route path in out/renderer and ignores src/", () => {
    expect(galleryLeaksIn(asar({ "out/renderer/assets/dev-gallery-page-x.js": "x" }))).toHaveLength(
      1,
    );
    expect(
      galleryLeaksIn(asar({ "out/renderer/assets/index-x.js": 'a={path:"/gallery"}' })),
    ).toHaveLength(1);
    expect(
      galleryLeaksIn(
        asar({
          "out/renderer/assets/index-x.js": "a",
          "src/renderer/src/features/dev-gallery/dev-gallery-page.tsx": '"/gallery"',
        }),
      ),
    ).toEqual([]);
  });
});

describe("real keychain restart check", () => {
  const launch = (
    source: "created" | "read",
    sha256: string,
    level: "os-keychain" | "basic-text" = "os-keychain",
  ): StorageSmoke => ({
    protection: level === "os-keychain" ? { level, backend: "keychain" } : { level },
    report: {} as StorageSmoke["report"],
    keyCheck: { source, sha256 },
  });

  // Guards: a keychain that loses or changes the key across a restart passing the smoke, which would make the mailbox database unreadable.
  it.each([
    ["a different key", launch("read", "bb")],
    ["no key read back", { ...launch("read", "aa"), keyCheck: undefined }],
    ["a key created again", launch("created", "aa")],
  ])("fails on macOS when the second launch has %s", (_name, second) => {
    expect(() => checkKeychainRestart("darwin", launch("created", "aa"), second)).toThrow();
  });

  it("passes when the second launch reads the same key back", () => {
    expect(checkKeychainRestart("win32", launch("created", "aa"), launch("read", "aa"))).toContain(
      "survived a restart",
    );
  });

  // Guards: the Linux runner (no secret service) failing the build, or the missing proof going unrecorded.
  it("records that Linux without a secret service was not exercised", () => {
    const none = { ...launch("created", "aa", "basic-text"), keyCheck: undefined };
    expect(checkKeychainRestart("linux", none, none)).toContain("not exercised");
  });
});
