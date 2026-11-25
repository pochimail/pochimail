import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { fuses } from "../src/main/fuses.ts";
import { electronBinaryPath } from "./apply-fuses.ts";
import { galleryLeaksIn } from "./gallery-check.ts";
import { launchSmoke } from "./launch-smoke.ts";
import { checkStorageOutput, storageSummary } from "./storage-check.ts";

/** Smoke test of a packaged build: fuses are flipped on the binary and the app starts, loads its window and quits. */
const releaseDir = join(import.meta.dirname, "..", "release");
const unpackedDirs: Record<string, string[]> = {
  darwin: ["mac-universal"],
  win32: ["win-unpacked"],
  linux: ["linux-unpacked"],
};

const appOutDir = (unpackedDirs[process.platform] ?? [])
  .map((name) => join(releaseDir, name))
  .find((dir) => existsSync(dir));
if (appOutDir === undefined) {
  throw new Error(
    `No unpacked app in ${releaseDir} (found: ${readdirSync(releaseDir).join(", ")})`,
  );
}
const binary = electronBinaryPath({
  platform: process.platform,
  appOutDir,
  productFilename: "Pochimail",
  executableName: "pochimail",
});

// M4-18: the dev gallery route must not ship.
const asarPath = join(
  process.platform === "darwin"
    ? join(appOutDir, "Pochimail.app", "Contents", "Resources")
    : join(appOutDir, "resources"),
  "app.asar",
);
const leaked = galleryLeaksIn(readFileSync(asarPath));
if (leaked.length > 0)
  throw new Error(`The packaged app contains the dev gallery (${leaked.join(", ")})`);
console.log("gallery: absent");

const wire = await getCurrentFuseWire(binary);
const expected = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} as const;
for (const [option, enabled] of Object.entries(expected)) {
  const actual = wire[Number(option) as keyof typeof wire];
  if (actual !== (enabled ? FuseState.ENABLE : FuseState.DISABLE)) {
    throw new Error(`Fuse ${FuseV1Options[Number(option)]} is ${FuseState[actual as number]}`);
  }
}
if (Object.keys(expected).length !== Object.keys(fuses).filter((k) => /^\d+$/.test(k)).length) {
  throw new Error("smoke.ts fuse list is out of sync with src/main/fuses.ts");
}
console.log("fuses: ok");

// Headless launch (see launch-smoke.ts).
const { code, output } = await launchSmoke(binary);
if (code !== 0 || !output.includes("smoke:window-loaded")) {
  throw new Error(`App did not start cleanly (exit ${code}). Output: ${output}`);
}
console.log("launch: ok");

// M0-12: the packaged app opened an encrypted WAL database with FTS5 in a utility process, with the key from safeStorage.
const storage = checkStorageOutput(output);
console.log("storage: ok");
console.log(storageSummary(process.platform, storage));
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined)
  appendFileSync(summary, `${storageSummary(process.platform, storage)}\n`);
