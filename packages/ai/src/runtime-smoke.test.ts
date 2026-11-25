import { describe, expect, it } from "vitest";
import { proveRuntimes } from "./runtime-smoke.ts";

describe("proveRuntimes", () => {
  // Guards: a packaged build that ships without its native runtimes, or a smoke that passes without running them.
  it("runs the embeddings graph, imports Transformers.js and loads the llama binding", async () => {
    const proof = await proveRuntimes();
    expect(proof).toEqual({
      onnx: { ok: true, detail: "identity graph ran" },
      transformers: { ok: true, detail: "imported" },
      llama:
        process.platform === "linux"
          ? { skipped: expect.stringContaining("runAsNode") }
          : { ok: true, detail: "binding loaded" },
    });
  });
});
