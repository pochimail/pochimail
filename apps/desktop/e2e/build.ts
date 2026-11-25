import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { appRoot } from "./app.ts";

// Builds the app with the dev gallery on (POCHIMAIL_E2E=1) into its own folder; the production `out/` is never touched.
const electronVite = join(appRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");
execFileSync(process.execPath, [electronVite, "build"], {
  cwd: appRoot,
  env: { ...process.env, POCHIMAIL_E2E: "1" },
});
