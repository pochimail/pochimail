import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { buildCsp } from "./src/shared/csp.ts";
import { E2E_OUT_DIR, galleryDefine, galleryEnabled } from "./src/shared/gallery-build.ts";

const injectCsp = (): Plugin => {
  let dev = false;
  return {
    name: "pochimail:csp",
    configResolved: (config) => {
      dev = config.command === "serve";
    },
    transformIndexHtml: (html) => html.replace("%CSP%", buildCsp({ dev })),
  };
};

const outRoot = resolve(
  import.meta.dirname,
  process.env.POCHIMAIL_E2E === "1" ? E2E_OUT_DIR : "out",
);

export default defineConfig(({ command }) => ({
  main: {
    build: {
      outDir: resolve(outRoot, "main"),
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/main/main.ts"),
          worker: resolve(import.meta.dirname, "src/worker/worker.ts"),
          "model-host": resolve(import.meta.dirname, "src/model-host/model-host.ts"),
          "storage-smoke": resolve(import.meta.dirname, "src/worker/storage-smoke.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      outDir: resolve(outRoot, "preload"),
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/preload.ts") },
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    define: galleryDefine(galleryEnabled(command, process.env)),
    build: {
      outDir: resolve(outRoot, "renderer"),
      rollupOptions: { input: { index: resolve(import.meta.dirname, "src/renderer/index.html") } },
    },
    plugins: [injectCsp(), tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  },
}));
