import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Configuration } from "electron-builder";
import { applyFuses } from "./packaging/apply-fuses.ts";
import { RELEASE_ASSETS } from "./packaging/release-assets.ts";
import { signingFor } from "./packaging/signing-mode.ts";

/** The repository URL lives in the root package.json only (AGENTS.md); .deb metadata needs a homepage, derived from it. */
const rootManifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"),
) as { repository: { url: string } };
const homepage = rootManifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

/** Pinned so the fuse step and the smoke script can find the Linux binary. */
const linuxExecutableName = "pochimail";

/** Drops the Node-API prebuilds of other OS/CPU pairs. */
const driverPrebuilds = "node_modules/better-sqlite3-multiple-ciphers/prebuilds";
const onlyPrebuild = (os: string): string[] => [`!${driverPrebuilds}/!(${os}-\${arch}).node`];

/**
 * onnxruntime-node ships every OS and CPU in `bin/napi-v6/<os>/<arch>` (about 290 MB): keep the target's folder only
 * (ADR 0006): every other OS folder goes, and within the OS every other CPU.
 */
const runtimeBinaries = "node_modules/onnxruntime-node/bin/napi-v6";
const onlyRuntime = (os: string): string[] => [
  `!${runtimeBinaries}/!(${os})/**`,
  `!${runtimeBinaries}/${os}/!(\${arch})/**`,
];

/** One file for the app and its helper processes: the hardened runtime needs it on both, kept to what Electron and the native modules need. */
const entitlements = "build/entitlements.mac.plist";

/** Env var that holds a Windows signing value (names in docs/release.md); an empty string never reaches a signed build. */
const required = (env: NodeJS.ProcessEnv, name: string): string => env[name] ?? "";

/**
 * The packaging config. Signing is a release-only setting (#298): PR, merge-queue and smoke builds stay unsigned whatever
 * the environment holds. In a release build an OS signs only when all of its secrets exist, and a partial set throws.
 * electron-builder signs after `afterPack`, so the fuses are always flipped first. There is no `publish` and no update
 * metadata: the app only notices new versions (#300) and nothing installs itself.
 */
export const buildConfig = (env: NodeJS.ProcessEnv): Configuration => {
  const mac = signingFor("mac", env);
  const windows = signingFor("windows", env);
  for (const status of [mac, windows])
    if (status.mode === "invalid")
      throw new Error(`Signing secrets are only partly set: missing ${status.missing.join(", ")}`);

  return {
    appId: "com.pochimail.desktop",
    productName: "Pochimail",
    directories: { buildResources: "build", output: "release" },
    // The electron-vite output ships. Renderer deps are devDependencies bundled by Vite, so node_modules only carries the
    // production dependencies that stay external: the SQLite driver (M0-12).
    // Not needed at run time: Transformers.js bundles its web runtime, so onnxruntime-web (145 MB) is dead weight, and
    // node-llama-cpp's git bundle of llama.cpp is only for source builds, which the app never does. Linux and Windows run
    // the model on the CPU in v1 (ADR 0006), so the CUDA and Vulkan backends stay out.
    files: [
      "out/**",
      "package.json",
      "!node_modules/onnxruntime-web/**",
      "!node_modules/node-llama-cpp/llama/gitRelease.bundle",
      "!node_modules/@node-llama-cpp/*-cuda*/**",
      "!node_modules/@node-llama-cpp/*-vulkan*/**",
    ],
    // dlopen cannot read a .node file inside app.asar. The driver ships Node-API prebuilds for all six OS/CPU pairs.
    // The same holds for the local model runtimes: onnxruntime-node (embeddings), node-llama-cpp's per-platform binary
    // packages (generative model) and sharp's, which Transformers.js loads at start (M3).
    asarUnpack: [
      "**/node_modules/better-sqlite3-multiple-ciphers/prebuilds/*.node",
      "**/node_modules/onnxruntime-node/bin/**",
      "**/node_modules/@node-llama-cpp/*/bins/**",
      "**/node_modules/@img/*/lib/**",
    ],
    extraMetadata: { homepage },
    asar: true,
    // The tray images load from the app's resources folder, outside app.asar.
    extraResources: [{ from: "resources/tray", to: "tray" }],
    // Native modules (SQLite driver, node-llama-cpp, onnxruntime-node) are rebuilt for Electron per OS and CPU here.
    npmRebuild: true,
    afterPack: async (context) => {
      await applyFuses({
        platform: context.electronPlatformName,
        appOutDir: context.appOutDir,
        productFilename: context.packager.appInfo.productFilename,
        executableName: linuxExecutableName,
      });
    },
    mac: {
      category: "public.app-category.productivity",
      icon: "build/icon.icns",
      // dmg only: the zip served an updater that v1 does not have.
      target: [{ target: "dmg", arch: "universal" }],
      ...(mac.mode === "signed"
        ? {
            hardenedRuntime: true,
            notarize: true,
            entitlements,
            entitlementsInherit: entitlements,
          }
        : { identity: null }),
      // Both darwin prebuilds stay in both slices: the universal merge needs the same Mach-O files in each, and accepts the identical copies only when listed here.
      files: [`!${driverPrebuilds}/!(darwin-*).node`, `!${runtimeBinaries}/!(darwin)/**`],
      x64ArchFiles:
        "**/{prebuilds/darwin-*.node,onnxruntime-node/bin/**,@node-llama-cpp/*/bins/**,@img/**,@reflink/**}",
    },
    dmg: { artifactName: RELEASE_ASSETS.mac[0], writeUpdateInfo: false },
    win: {
      icon: "build/icon.ico",
      target: [{ target: "nsis", arch: "x64" }],
      files: [...onlyPrebuild("win32"), ...onlyRuntime("win32")],
      ...(windows.mode === "signed"
        ? {
            azureSignOptions: {
              publisherName: required(env, "AZURE_TS_PUBLISHER"),
              endpoint: required(env, "AZURE_TS_ENDPOINT"),
              codeSigningAccountName: required(env, "AZURE_TS_ACCOUNT"),
              certificateProfileName: required(env, "AZURE_TS_PROFILE"),
            },
          }
        : {}),
    },
    nsis: { artifactName: RELEASE_ASSETS.windows[0], differentialPackage: false },
    linux: {
      icon: "build/icons",
      executableName: linuxExecutableName,
      category: "Office",
      maintainer: "Pochimail contributors <noreply@users.noreply.github.com>",
      target: ["AppImage", "deb", "rpm"],
      files: [...onlyPrebuild("linux"), ...onlyRuntime("linux")],
    },
    appImage: { artifactName: RELEASE_ASSETS.linux[0] },
    deb: { artifactName: RELEASE_ASSETS.linux[1] },
    rpm: { artifactName: RELEASE_ASSETS.linux[2] },
  };
};

export default buildConfig(process.env);
