import { spawn } from "node:child_process";

/**
 * Starts a packaged app in smoke mode and waits for it to quit. Linux CI wraps this in xvfb-run and its chrome-sandbox helper is
 * not setuid, hence --no-sandbox there only. In smoke mode the app quits itself once the window has loaded.
 */
export const launchSmoke = async (
  binary: string,
  env: Record<string, string> = {},
  userData?: string,
): Promise<{ code: number | null; output: string }> => {
  const args = [
    ...(userData === undefined ? [] : [`--user-data-dir=${userData}`]),
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ];
  const child = spawn(binary, args, {
    env: { ...process.env, ...env, POCHIMAIL_SMOKE: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  clearTimeout(timer);
  return { code, output };
};
