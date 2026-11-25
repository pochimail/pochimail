import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRuntimesOutput, checkUnpackedRuntimes } from "./runtime-check.ts";

const line = (proof: unknown) => `noise\nsmoke:runtimes ${JSON.stringify(proof)}\n`;
const good = {
  onnx: { ok: true, detail: "identity graph ran" },
  transformers: { ok: true, detail: "imported" },
  llama: { ok: true, detail: "binding loaded" },
};

describe("runtime smoke output", () => {
  // Guards: a packaged build whose native runtimes fail to load still passing the smoke.
  it("passes when every runtime loaded", () => {
    expect(checkRuntimesOutput(line(good))).toEqual([
      "onnx: identity graph ran",
      "transformers: imported",
      "llama: binding loaded",
    ]);
  });

  // Guards: a skip hiding a runtime that failed, or a skip not showing in the log.
  it("passes a runtime that says why it was skipped, and prints the reason", () => {
    const out = checkRuntimesOutput(line({ ...good, llama: { skipped: "no fork" } }));
    expect(out[2]).toBe("llama: skipped, no fork");
  });

  it.each([
    ["no line at all", "app started\n", /printed no runtime result/],
    [
      "a runtime that failed",
      line({ ...good, onnx: { ok: false, error: "no binding" } }),
      /onnx: no binding/,
    ],
    [
      "a runtime that is missing",
      line({ onnx: good.onnx, llama: good.llama }),
      /transformers: missing/,
    ],
    ["a worker that died", line({ error: "runtime worker exited with 1" }), /exited with 1/],
  ])("fails on %s", (_name, output, message) => {
    expect(() => checkRuntimesOutput(output)).toThrow(message);
  });
});

describe("unpacked runtimes", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const resources = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-check-"));
    dirs.push(dir);
    for (const file of files) {
      const path = join(dir, "app.asar.unpacked", "node_modules", file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "");
    }
    return dir;
  };
  const llama = "@node-llama-cpp/linux-x64/bins/linux-x64/llama-addon.node";
  const onnx = (folder: string) =>
    `onnxruntime-node/bin/napi-v6/${folder}/onnxruntime_binding.node`;

  // Guards: a package without its native files in the asar-unpacked folder, or one that still ships every other OS.
  it("accepts the target OS's files and nothing else", () => {
    expect(checkUnpackedRuntimes(resources([onnx("linux/x64"), llama]), "linux")).toEqual([]);
  });

  it("names a missing onnxruntime-node binding, a foreign OS and a missing llama binary", () => {
    const problems = checkUnpackedRuntimes(resources([onnx("win32/x64")]), "linux");
    expect(problems).toEqual([
      "onnxruntime-node linux/x64 is missing from app.asar.unpacked",
      "onnxruntime-node ships win32 too",
      "no node-llama-cpp binary package is in app.asar.unpacked",
    ]);
  });
});
