import { type DemoScale, demoSwitches } from "../shared/demo.ts";

// Hosts get no copy of the parent environment: only what a process needs to start, plus the demo switch.
const SYSTEM_ENV = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "LANG",
  "LC_ALL",
] as const;

const pick = (
  env: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = env[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  );

/** The environment of the model host (`demoEnv`) and of the worker, which alone also gets the sign-in configuration. */
export const hostEnvironments = (
  demo: DemoScale | undefined,
  env: Readonly<Record<string, string | undefined>>,
): {
  readonly demoEnv: Record<string, string>;
  readonly workerEnv: () => Record<string, string>;
} => {
  const demoEnv = { ...pick(env, SYSTEM_ENV), ...demoSwitches(demo, env) };
  return {
    demoEnv,
    workerEnv: () => ({
      ...demoEnv,
      ...pick(env, ["POCHIMAIL_GOOGLE_CLIENT_ID", "POCHIMAIL_GOOGLE_CLIENT_SECRET"]),
    }),
  };
};
