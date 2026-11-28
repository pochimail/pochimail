import type { UtilityProcess } from "electron";

/** Packaging smoke (M3): the local model runtimes load inside a utilityProcess of the packaged app; prints one line for `packaging/smoke.ts`. */
export const smokeRuntimes = async (fork: () => UtilityProcess): Promise<void> => {
  const child = fork();
  try {
    const proof = await new Promise<unknown>((resolve) => {
      child.once("message", resolve);
      child.once("exit", (code) => resolve({ error: `runtime worker exited with ${code}` }));
    });
    process.stdout.write(`smoke:runtimes ${JSON.stringify(proof)}\n`);
  } finally {
    child.kill();
  }
};
