import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { fuses } from "../src/main/fuses.ts";
import { electronBinaryPath } from "./apply-fuses.ts";
import { galleryLeaksIn } from "./gallery-check.ts";
import { launchSmoke } from "./launch-smoke.ts";
import { checkRuntimesOutput, checkUnpackedRuntimes } from "./runtime-check.ts";
import { checkKeychainRestart, checkStorageOutput, storageSummary } from "./storage-check.ts";

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
const resourcesDir =
  process.platform === "darwin"
    ? join(appOutDir, "Pochimail.app", "Contents", "Resources")
    : join(appOutDir, "resources");
const asarPath = join(resourcesDir, "app.asar");
const leaked = galleryLeaksIn(readFileSync(asarPath));
if (leaked.length > 0)
  throw new Error(`The packaged app contains the dev gallery (${leaked.join(", ")})`);
console.log("gallery: absent");

// M3: the local model runtimes ship unpacked, for the target OS only.
const unpacked = checkUnpackedRuntimes(resourcesDir, process.platform);
if (unpacked.length > 0) throw new Error(`Local model runtimes: ${unpacked.join("; ")}`);
console.log("runtimes: unpacked");

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

// Headless launch (see launch-smoke.ts). Its own user data folder: Electron keys the single-instance lock on it, so the smoke neither fails while a real Pochimail runs nor touches its data.
const userData = mkdtempSync(join(tmpdir(), "pochimail-smoke-"));
const launch = async (env: Record<string, string>): Promise<string> => {
  const { code, output } = await launchSmoke(binary, env, userData);
  if (code !== 0 || !output.includes("smoke:window-loaded")) {
    throw new Error(`App did not start cleanly (exit ${code}). Output: ${output}`);
  }
  return output;
};
// Two launches share one wrapped key file: the second reads back, through the real OS keychain, the key the first created.
const keyDir = mkdtempSync(join(tmpdir(), "pochimail-smoke-key-"));
const keyEnv = { POCHIMAIL_SMOKE_KEY_FILE: join(keyDir, "db.key") };
let output: string;
let restartOutput: string;
try {
  output = await launch(keyEnv);
  console.log("launch: ok");
  restartOutput = await launch(keyEnv);
  console.log("restart: ok");
} finally {
  rmSync(keyDir, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
}

// M3: the packaged app loaded onnxruntime-node, Transformers.js and node-llama-cpp in a utility process.
for (const line of checkRuntimesOutput(output)) console.log(`runtime ${line}`);
console.log("runtimes: ok");

// M0-12: the packaged app opened an encrypted WAL database with FTS5 in a utility process, with the key from safeStorage.
const storage = checkStorageOutput(output);
console.log("storage: ok");
console.log(checkKeychainRestart(process.platform, storage, checkStorageOutput(restartOutput)));
console.log(storageSummary(process.platform, storage));
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined)
  appendFileSync(summary, `${storageSummary(process.platform, storage)}\n`);
