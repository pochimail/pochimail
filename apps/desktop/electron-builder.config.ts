import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Configuration } from "electron-builder";
import { applyFuses } from "./packaging/apply-fuses.ts";

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

/** Unsigned smoke-build config (M0-10). Signing, notarization and update metadata arrive with the release tickets. */
const config: Configuration = {
  appId: "com.pochimail.desktop",
  productName: "Pochimail",
  // The package name is scoped (@pochimail/desktop); without this the .deb path contains a slash.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder macros, not a JS template
  artifactName: "Pochimail-${version}-${os}-${arch}.${ext}",
  directories: { buildResources: "build", output: "release" },
  // The electron-vite output ships. Renderer deps are devDependencies bundled by Vite, so node_modules only carries the
  // production dependencies that stay external: the SQLite driver (M0-12).
  // Not needed at run time: Transformers.js bundles its web runtime, so onnxruntime-web (145 MB) is dead weight, and
  // node-llama-cpp's git bundle of llama.cpp is only for source builds, which the app never does. CUDA backends (200 and
  // 400 MB) stay out until the installer size budget is decided; Vulkan covers NVIDIA GPUs.
  files: [
    "out/**",
    "package.json",
    "!node_modules/onnxruntime-web/**",
    "!node_modules/node-llama-cpp/llama/gitRelease.bundle",
    "!node_modules/@node-llama-cpp/*-cuda*/**",
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
    target: [
      { target: "dmg", arch: "universal" },
      { target: "zip", arch: "universal" },
    ],
    identity: null,
    // Both darwin prebuilds stay in both slices: the universal merge needs the same Mach-O files in each, and accepts the identical copies only when listed here.
    files: [`!${driverPrebuilds}/!(darwin-*).node`, `!${runtimeBinaries}/!(darwin)/**`],
    x64ArchFiles:
      "**/{prebuilds/darwin-*.node,onnxruntime-node/bin/**,@node-llama-cpp/*/bins/**,@img/**,@reflink/**}",
  },
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: "x64" }],
    files: [...onlyPrebuild("win32"), ...onlyRuntime("win32")],
  },
  linux: {
    icon: "build/icons",
    executableName: linuxExecutableName,
    category: "Office",
    maintainer: "Pochimail contributors <noreply@users.noreply.github.com>",
    target: ["AppImage", "deb", "rpm"],
    files: [...onlyPrebuild("linux"), ...onlyRuntime("linux")],
  },
};

export default config;
