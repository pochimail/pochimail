import { defineConfig } from "vitest/config";
import { galleryDefine } from "./src/shared/gallery-build.ts";

// Tests run like a dev build: the gallery route exists (gallery-build.test.ts builds the production bundle to prove it does not).
export default defineConfig({
  define: galleryDefine(true),
  // Real-worker tests open an encrypted SQLite file and a loopback server per test; a cold Windows runner needs more than vitest's 5 s default (Guards: a timeout that fails the queue without a regression).
  test: { setupFiles: ["./src/test-setup.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
});
