// Dev launcher: makes every git worktree pick up the maintainer's keys from the main checkout's .env.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

if (!process.env.POCHIMAIL_GOOGLE_CLIENT_ID) {
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  });
  const envFile = git.status === 0 ? join(dirname(git.stdout.trim()), ".env") : undefined;
  if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
}

const dev = spawnSync(
  process.execPath,
  ["node_modules/electron-vite/bin/electron-vite.js", "dev"],
  {
    stdio: "inherit",
  },
);
process.exit(dev.status ?? 1);
