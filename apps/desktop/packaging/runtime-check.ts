import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RUNTIMES = ["onnx", "transformers", "llama"] as const;

/** Reads the `smoke:runtimes` line the packaged app prints and fails unless each native runtime loaded. */
export const checkRuntimesOutput = (output: string): string[] => {
  const line = output.split("\n").find((l) => l.startsWith("smoke:runtimes "));
  if (line === undefined)
    throw new Error(`The packaged app printed no runtime result. Output: ${output}`);
  const proof = JSON.parse(line.slice("smoke:runtimes ".length)) as Record<
    string,
    { ok?: boolean; detail?: string; error?: string } | undefined
  > & { error?: string };
  if (proof.error !== undefined) throw new Error(`Runtime proof failed: ${proof.error}`);
  const failed = RUNTIMES.filter((name) => proof[name]?.ok !== true);
  if (failed.length > 0)
    throw new Error(
      `Runtime proof failed: ${failed.map((name) => `${name}: ${proof[name]?.error ?? "missing"}`).join("; ")}`,
    );
  return RUNTIMES.map((name) => `${name}: ${proof[name]?.detail}`);
};

/** onnxruntime-node folders the target OS ships: one per CPU it supports (macOS has no x64 build upstream). */
const onnxFolders: Record<string, string[]> = {
  darwin: ["darwin/arm64"],
  win32: ["win32/x64"],
  linux: ["linux/x64"],
};

/** The native files must sit in `app.asar.unpacked` (dlopen cannot read inside the asar), and no other OS's runtime may ship. */
export const checkUnpackedRuntimes = (resourcesDir: string, platform: string): string[] => {
  const modules = join(resourcesDir, "app.asar.unpacked", "node_modules");
  const problems: string[] = [];
  const napi = join(modules, "onnxruntime-node", "bin", "napi-v6");
  for (const folder of onnxFolders[platform] ?? []) {
    if (!existsSync(join(napi, folder, "onnxruntime_binding.node")))
      problems.push(`onnxruntime-node ${folder} is missing from app.asar.unpacked`);
  }
  const shipped = existsSync(napi) ? readdirSync(napi) : [];
  const foreign = shipped.filter((os) => os !== platform);
  if (foreign.length > 0) problems.push(`onnxruntime-node ships ${foreign.join(", ")} too`);
  const llama = join(modules, "@node-llama-cpp");
  const bindings = existsSync(llama)
    ? readdirSync(llama).filter((pkg) => existsSync(join(llama, pkg, "bins")))
    : [];
  if (bindings.length === 0)
    problems.push("no node-llama-cpp binary package is in app.asar.unpacked");
  return problems;
};
