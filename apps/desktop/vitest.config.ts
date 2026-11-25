import { defineConfig } from "vitest/config";
import { galleryDefine } from "./src/shared/gallery-build.ts";

// Tests run like a dev build: the gallery route exists (gallery-build.test.ts builds the production bundle to prove it does not).
export default defineConfig({
  define: galleryDefine(true),
  test: { setupFiles: ["./src/test-setup.ts"] },
});
