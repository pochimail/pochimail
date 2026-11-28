import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleRelease } from "./assemble-release.ts";
import { allReleaseAssets, releaseNotes, versionFromTag } from "./release-assets.ts";

const dirs: string[] = [];
const releaseDir = (names: readonly string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-release-"));
  dirs.push(dir);
  for (const name of names) writeFileSync(join(dir, name), name);
  writeFileSync(join(dir, "signing-mac.txt"), "unsigned");
  writeFileSync(join(dir, "signing-windows.txt"), "unsigned");
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("release assembly", () => {
  // Guards: a release missing an installer, a checksum line, or a latest.json that is not exactly the tag's version.
  it("writes SHA256SUMS for all five assets and a version-only latest.json", () => {
    expect(allReleaseAssets()).toHaveLength(5);
    const dir = releaseDir(allReleaseAssets());
    assembleRelease(dir, "1.2.3");
    const sums = readFileSync(join(dir, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(sums.map((line) => line.split("  ")[1])).toEqual([...allReleaseAssets()].sort());
    expect(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"))).toEqual({
      version: "1.2.3",
    });
  });

  it("refuses to assemble when an installer is missing", () => {
    const dir = releaseDir(allReleaseAssets().slice(1));
    expect(() => assembleRelease(dir, "1.2.3")).toThrow(/missing/i);
  });

  // Guards: a tag that is not a plain release version publishing a version the update notice would compare wrongly.
  it("accepts only vX.Y.Z tags", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
    for (const tag of ["1.2.3", "v1.2", "v1.2.3-beta.1", "v1.2.3.4", "main"])
      expect(() => versionFromTag(tag)).toThrow();
  });

  // Guards: release notes that hide that a build is unsigned.
  it("states which installers are unsigned", () => {
    const notes = releaseNotes("1.0.0", { mac: "unsigned", windows: "signed" });
    expect(notes).toContain("not code-signed");
    expect(notes).toContain("Pochimail-mac-universal.dmg");
    expect(notes).not.toContain("Pochimail-win-x64.exe");
  });
});
