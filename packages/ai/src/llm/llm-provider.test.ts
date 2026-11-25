import {
  jsonLlmProviderContract,
  llmProviderContract,
} from "@pochimail/classification/testing/ai-contract";
import { aborted, live } from "@pochimail/classification/testing/samples";
import { createCancelSource } from "@pochimail/kernel/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFakeLlmRuntime } from "../test-support/fake-llm-runtime.ts";
import { createLlmProvider } from "./llm-provider.ts";

const schema = z.object({ category: z.enum(["people", "records"]) });
const present = async () => "model.gguf";

const setup = (options: Partial<Parameters<typeof createLlmProvider>[0]> = {}) => {
  const runtime = createFakeLlmRuntime();
  const llm = createLlmProvider({ runtime, modelPath: present, ...options });
  return { runtime, llm };
};

const never = (llm: ReturnType<typeof setup>["llm"]) =>
  llm.completeJson({ prompt: "p", schema }, aborted());

// The same cases run against the real model in llama-real.test.ts and against the fake in the classification package.
llmProviderContract(() => setup().llm);
jsonLlmProviderContract(() => setup().llm);

afterEach(() => vi.useRealTimers());

describe("createLlmProvider", () => {
  // Guards: ADR 0006 known limit: Qwen3.5 with thoughtTokens 0 returns the object without its opening brace.
  it("accepts an object whose opening brace the runtime dropped", async () => {
    const { runtime, llm } = setup();
    runtime.reply('"category":"records"}');
    const out = await llm.completeJson({ prompt: "p", schema }, live());
    expect(out).toEqual({ ok: true, value: { category: "records" } });
  });

  // Guards: a guess standing in for output that is not what the schema allows.
  it.each([
    ["not json", "Sure! It is a people email."],
    ["a value outside the enum", '{"category":"promotions"}'],
    ["a missing field", "{}"],
    ["an empty answer", ""],
  ])("rejects %s as invalid_output", async (_name, answer) => {
    const { runtime, llm } = setup();
    runtime.reply(answer);
    const out = await llm.completeJson({ prompt: "p", schema }, live());
    expect(out.ok ? undefined : out.error.code).toBe("ai.invalid_output");
  });

  // Guards: decoding that is not constrained to the schema the caller will parse with.
  it("sends the schema to the runtime and keeps prompt and system as given", async () => {
    const { runtime, llm } = setup();
    runtime.reply('{"category":"people"}');
    await llm.completeJson({ system: "s", prompt: "p", maxTokens: 16, schema }, live());
    expect(runtime.generations[0]).toMatchObject({
      system: "s",
      prompt: "p",
      maxTokens: 16,
      jsonSchema: { type: "object", required: ["category"] },
    });
    expect(runtime.generations[0]?.jsonSchema).not.toHaveProperty("$schema");
  });

  // Guards: a missing model file taking the host down, or being reported as another error.
  it("answers unavailable when the model file is absent, and loads once it appears", async () => {
    let path: string | undefined;
    const { runtime, llm } = setup({ modelPath: async () => path });
    const missing = await llm.complete({ prompt: "p" }, live());
    expect(missing.ok ? undefined : missing.error.code).toBe("ai.unavailable");
    expect(runtime.stats.loads).toBe(0);
    path = "model.gguf";
    expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
  });

  // Guards: a runtime that fails to load or crashes mid-answer escaping as an exception or leaving a dead context.
  it("answers unavailable on a load failure or a crash, then loads a fresh model", async () => {
    const { runtime, llm } = setup();
    runtime.failNextLoad();
    const failedLoad = await llm.complete({ prompt: "p" }, live());
    expect(failedLoad.ok ? undefined : failedLoad.error.code).toBe("ai.unavailable");
    expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
    runtime.failNextGeneration();
    const crashed = await llm.complete({ prompt: "p" }, live());
    expect(crashed.ok ? undefined : crashed.error.code).toBe("ai.unavailable");
    expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
    expect(runtime.stats.loads).toBe(2);
    expect(runtime.stats.disposed).toBe(1);
  });

  // Guards: a cancelled request that keeps its context sequence busy.
  it("stops a running generation when cancelled and frees it for the next", async () => {
    const { runtime, llm } = setup();
    runtime.hold();
    const cancel = createCancelSource();
    const running = llm.complete({ prompt: "p" }, cancel.signal);
    await vi.waitFor(() => expect(runtime.stats.active).toBe(1));
    cancel.abort();
    const out = await running;
    expect(out.ok ? undefined : out.error.code).toBe("operation.cancelled");
    expect(runtime.stats).toMatchObject({ active: 0, stopped: 1 });
    runtime.release();
    expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
  });

  // Guards: a cancel that arrives while the model loads being ignored, so the generation runs to its timeout.
  it("honours a cancel that arrives while the model is loading", async () => {
    const { runtime, llm } = setup();
    runtime.holdLoad();
    const cancel = createCancelSource();
    const running = llm.complete({ prompt: "p" }, cancel.signal);
    await vi.waitFor(() => expect(runtime.stats.loads).toBe(0));
    cancel.abort();
    runtime.releaseLoad();
    const out = await running;
    expect(out.ok ? undefined : out.error.code).toBe("operation.cancelled");
    expect(runtime.generations).toHaveLength(0);
    expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
  });

  // Guards: a second model loaded while the first is still being freed (both in memory at once).
  it("waits for a model being freed before it loads the next", async () => {
    const { runtime, llm } = setup();
    await llm.complete({ prompt: "p" }, live());
    runtime.holdDispose();
    const unloading = llm.unload();
    const next = llm.complete({ prompt: "p" }, live());
    await vi.waitFor(() => expect(runtime.stats.alive).toBe(1));
    await Promise.resolve();
    expect(runtime.stats.loads).toBe(1);
    runtime.releaseDispose();
    await unloading;
    expect((await next).ok).toBe(true);
    expect(runtime.stats).toMatchObject({ loads: 2, peakAlive: 1 });
  });

  // Guards: a model that ignores its abort keeping the slot, and every later request, forever.
  it.each([
    ["its timeout", undefined, "ai.unavailable"],
    ["a cancel", createCancelSource, "operation.cancelled"],
  ])(
    "gives up a model that ignores %s, discards it and loads a fresh one",
    async (_name, source, code) => {
      vi.useFakeTimers();
      const { runtime, llm } = setup({ timeoutMs: 1000 });
      runtime.hangNextGeneration();
      const cancel = source?.();
      const running = llm.complete({ prompt: "p" }, cancel?.signal ?? live());
      await vi.advanceTimersByTimeAsync(cancel === undefined ? 1000 : 10);
      cancel?.abort();
      await vi.advanceTimersByTimeAsync(5000);
      const out = await running;
      expect(out.ok ? undefined : out.error.code).toBe(code);
      expect(runtime.stats.disposed).toBe(1);
      expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
      expect(runtime.stats.loads).toBe(2);
    },
  );

  // Guards: a request the runtime cannot serve (a schema it cannot decode) unloading a healthy model.
  it("keeps the model when only the request was rejected", async () => {
    const { runtime, llm } = setup();
    runtime.rejectNextGeneration();
    const out = await llm.complete({ prompt: "p" }, live());
    expect(out.ok ? undefined : out.error.code).toBe("ai.unavailable");
    expect((await llm.complete({ prompt: "p" }, live())).ok).toBe(true);
    expect(runtime.stats).toMatchObject({ loads: 1, disposed: 0 });
  });

  // Guards: more generations than the context has sequences, or a cancelled waiter that still runs.
  it("never runs more generations than the bound, and a waiter that cancels never starts", async () => {
    const { runtime, llm } = setup({ concurrency: 2 });
    runtime.hold();
    const waiter = createCancelSource();
    const all = [
      llm.complete({ prompt: "1" }, live()),
      llm.complete({ prompt: "2" }, live()),
      llm.complete({ prompt: "3" }, waiter.signal),
      llm.complete({ prompt: "4" }, live()),
    ];
    await vi.waitFor(() => expect(runtime.stats.active).toBe(2));
    waiter.abort();
    runtime.release();
    const outs = await Promise.all(all);
    expect(outs.map((o) => o.ok)).toEqual([true, true, false, true]);
    expect(runtime.stats.peak).toBe(2);
    expect(runtime.generations.map((g) => g.prompt)).toEqual(["1", "2", "4"]);
  });

  // Guards: a hung model blocking its slot forever.
  it("stops a generation that outlives its timeout and answers unavailable", async () => {
    vi.useFakeTimers();
    const { runtime, llm } = setup({ timeoutMs: 1000 });
    runtime.hold();
    const running = llm.complete({ prompt: "p" }, live());
    await vi.advanceTimersByTimeAsync(1000);
    const out = await running;
    expect(out.ok ? undefined : out.error.code).toBe("ai.unavailable");
    expect(runtime.stats.stopped).toBe(1);
  });

  // Guards: a model that stays in memory for a user who is not scanning, and an unload that kills a running request.
  it("unloads after the idle time and reloads on the next request, but never while busy", async () => {
    vi.useFakeTimers();
    const { runtime, llm } = setup({ idleMs: 1000 });
    await llm.complete({ prompt: "p" }, live());
    runtime.hold();
    const running = llm.complete({ prompt: "p" }, live());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await llm.unload()).toBe(false);
    runtime.release();
    await running;
    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.stats.disposed).toBe(1);
    await llm.complete({ prompt: "p" }, live());
    expect(runtime.stats.loads).toBe(2);
    expect(await llm.unload()).toBe(true);
    expect(runtime.stats.disposed).toBe(2);
  });

  // Guards: prompt or answer text in a failure that reaches a log (ADR 0014).
  it("keeps prompt text out of every error", async () => {
    const { runtime, llm } = setup();
    runtime.reply("not json");
    const invalid = await llm.completeJson({ prompt: "SECRET-SUBJECT", schema }, live());
    runtime.failNextGeneration();
    const crashed = await llm.complete({ prompt: "SECRET-SUBJECT" }, live());
    for (const out of [invalid, crashed, await never(llm)]) {
      expect(JSON.stringify(out.ok ? {} : { m: out.error.message, c: out.error.code })).not.toMatch(
        /SECRET|not json/,
      );
    }
  });
});
