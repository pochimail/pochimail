import { createEmbedder } from "@pochimail/ai/embeddings/embedder";
import { createLlmProvider } from "@pochimail/ai/llm/llm-provider";
import { createFakeFeatureExtractor } from "@pochimail/ai/test-support/fake-feature-extractor";
import { createFakeLlmRuntime } from "@pochimail/ai/test-support/fake-llm-runtime";
import { createCancelSource } from "@pochimail/kernel/common";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fromDomPort } from "../shared/ipc/transport.ts";
import { createModelHostClient } from "../worker/model-host-client.ts";
import { loadEngine } from "./engine.ts";
import { createLocalEngine } from "./local-engine.ts";
import { serveModelHost } from "./serve.ts";

const answer = z.object({ answer: z.enum(["yes", "no"]) });
const open: MessagePort[] = [];
afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

/** The worker's client talking to the host's `serveModelHost` over a real MessageChannel, with the local models faked at the native boundary. */
const wire = (options: { modelPath?: string | undefined } = {}) => {
  const runtime = createFakeLlmRuntime();
  const extractor = createFakeFeatureExtractor();
  const present = async () => ("modelPath" in options ? options.modelPath : "model");
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  port1.start();
  port2.start();
  serveModelHost(fromDomPort(port2), {
    llm: createLlmProvider({ runtime, modelPath: present }),
    embedder: createEmbedder({ load: extractor.loader, modelDir: present }),
  });
  const client = createModelHostClient({ timer: createFakeTimer(), embedderDimensions: 384 });
  client.attach(fromDomPort(port1));
  const raw: unknown[] = [];
  port1.addEventListener("message", (event) => raw.push(event.data));
  return { runtime, client, port1, raw };
};
const live = () => createCancelSource().signal;

describe("local engine behind the model host", () => {
  // Guards: the worker getting an unchecked model answer, or the schema not reaching the host's decoder.
  it("answers a structured request with a value the worker's schema accepts", async () => {
    const { client, runtime } = wire();
    const out = await client.llm.completeJson({ prompt: "p", schema: answer }, live());
    expect(out).toEqual({ ok: true, value: { answer: "yes" } });
    expect(runtime.generations[0]?.jsonSchema).toMatchObject({
      type: "object",
      required: ["answer"],
    });
  });

  // Guards: Qwen3.5 without its opening brace (ADR 0006) or text that is not what the schema allows reaching a decision.
  it("restores a dropped opening brace and reports an answer the schema refuses as invalid_output", async () => {
    const { client, runtime } = wire();
    runtime.reply('"answer":"no"}', '{"answer":"maybe"}', "not json");
    const results = [];
    for (let i = 0; i < 3; i++)
      results.push(await client.llm.completeJson({ prompt: "p", schema: answer }, live()));
    expect(results[0]).toEqual({ ok: true, value: { answer: "no" } });
    expect(results.slice(1).map((r) => (r.ok ? "ok" : r.error.code))).toEqual([
      "ai.invalid_output",
      "ai.invalid_output",
    ]);
  });

  // Guards: a cancelled request that keeps the model busy in the host.
  it("stops the host's generation when the worker cancels", async () => {
    const { client, runtime } = wire();
    runtime.hold();
    const cancel = createCancelSource();
    const running = client.llm.complete({ prompt: "p" }, cancel.signal);
    await vi.waitFor(() => expect(runtime.stats.active).toBe(1));
    cancel.abort();
    expect((await running).ok).toBe(false);
    await vi.waitFor(() => expect(runtime.stats).toMatchObject({ active: 0, stopped: 1 }));
    runtime.release();
    expect((await client.llm.complete({ prompt: "p" }, live())).ok).toBe(true);
  });

  // Guards: a missing model file ending the host instead of answering unavailable, and the host not serving after it.
  it("answers unavailable for every method with no model files, and keeps serving", async () => {
    const { client, port1, raw } = wire({ modelPath: undefined });
    const codes = async () => [
      ...[await client.llm.complete({ prompt: "p" }, live())].map((r) =>
        r.ok ? "ok" : r.error.code,
      ),
      ...[await client.llm.completeJson({ prompt: "p", schema: answer }, live())].map((r) =>
        r.ok ? "ok" : r.error.code,
      ),
      ...[await client.embedder.embed(["a"], live())].map((r) => (r.ok ? "ok" : r.error.code)),
      ...[await client.classifier.classify([], live())].map((r) => (r.ok ? "ok" : r.error.code)),
    ];
    expect(await codes()).toEqual(Array(4).fill("ai.unavailable"));
    port1.postMessage({ id: 99, method: "complete", prompt: "again" });
    await vi.waitFor(() => expect(raw).toContainEqual({ id: 99, ok: false, error: "unavailable" }));
  });

  // Guards: vectors that do not survive the port, or a size the heads cannot take.
  it("sends embeddings to the worker in memory, one 384-wide vector per text", async () => {
    const { client } = wire();
    const out = await client.embedder.embed(["a", "b"], live());
    expect(out.ok ? out.value.map((v) => v.length) : out).toEqual([384, 384]);
  });

  // Guards: a schema or request the host did not validate, or a bad one stopping the host.
  it("drops a structured request whose schema is too large", async () => {
    const { port1, raw } = wire();
    port1.postMessage({
      id: 1,
      method: "completeJson",
      prompt: "p",
      jsonSchema: { pad: "x".repeat(30_000) },
    });
    port1.postMessage({ id: 2, method: "complete", prompt: "p" });
    await vi.waitFor(() => expect(raw).toEqual([{ id: 2, ok: true, result: '{"answer":"yes"}' }]));
  });

  // Guards: a schema that survives the port (cycles and BigInt do) but cannot be measured, throwing in the validator.
  it("drops a structured request whose schema cannot be serialised", async () => {
    const { port1, raw } = wire();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    port1.postMessage({ id: 1, method: "completeJson", prompt: "p", jsonSchema: cycle });
    port1.postMessage({ id: 2, method: "completeJson", prompt: "p", jsonSchema: { n: 1n } });
    port1.postMessage({ id: 3, method: "complete", prompt: "p" });
    await vi.waitFor(() => expect(raw).toEqual([{ id: 3, ok: true, result: '{"answer":"yes"}' }]));
  });
});

describe("loadEngine", () => {
  // Guards: native model libraries starting in a host that has no model paths, and a stubbed engine in production.
  it("has no engine without demo mode or model paths", async () => {
    expect(await loadEngine({})).toBeUndefined();
  });

  // Guards: a missing model file taking the host down at start.
  it("builds the local engine when a path is set, and a missing file is unavailable", async () => {
    const engine = await loadEngine({ POCHIMAIL_LLM_MODEL: "/nonexistent/model.gguf" });
    const out = await engine?.llm.complete({ prompt: "p" }, live());
    expect(out?.ok ? "ok" : out?.error.code).toBe("ai.unavailable");
    const embedded = await createLocalEngine({
      llmModel: undefined,
      embeddingModelDir: undefined,
    }).embedder.embed(["a"], live());
    expect(embedded.ok ? "ok" : embedded.error.code).toBe("ai.unavailable");
  });
});
