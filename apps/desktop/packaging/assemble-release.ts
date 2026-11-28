import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  allReleaseAssets,
  checksumFile,
  latestJson,
  releaseNotes,
  sha256,
} from "./release-assets.ts";

/** Adds `SHA256SUMS`, `latest.json` and `RELEASE_NOTES.md` next to the five installers. Fails if any installer is missing. */
export const assembleRelease = (dir: string, version: string): void => {
  const missing = allReleaseAssets().filter((name) => !existsSync(join(dir, name)));
  if (missing.length > 0) throw new Error(`Release is missing: ${missing.join(", ")}`);
  const entries = allReleaseAssets().map((name) => ({
    name,
    hash: sha256(readFileSync(join(dir, name))),
  }));
  const mode = (os: "mac" | "windows"): string =>
    readFileSync(join(dir, `signing-${os}.txt`), "utf8").trim();
  writeFileSync(join(dir, "SHA256SUMS"), checksumFile(entries));
  writeFileSync(join(dir, "latest.json"), latestJson(version));
  writeFileSync(
    join(dir, "RELEASE_NOTES.md"),
    releaseNotes(version, { mac: mode("mac"), windows: mode("windows") }),
  );
};
