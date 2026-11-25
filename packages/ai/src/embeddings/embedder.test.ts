import { embedderContract } from "@pochimail/classification/testing/ai-contract";
import { aborted, live } from "@pochimail/classification/testing/samples";
import { createCancelSource } from "@pochimail/kernel/common";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { createFakeFeatureExtractor } from "../test-support/fake-feature-extractor.ts";
import { createEmbedder, EMBEDDING_DIMENSIONS, MAX_INPUT_CHARS } from "./embedder.ts";

const setup = (options: { batchSize?: number; modelDir?: string | undefined } = {}) => {
  const fake = createFakeFeatureExtractor();
  const embedder = createEmbedder({
    load: fake.loader,
    modelDir: async () => ("modelDir" in options ? options.modelDir : "e5"),
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
  });
  return { fake, embedder };
};

embedderContract(() => setup().embedder);

describe("createEmbedder", () => {
  // Guards: a vector size the heads and clustering cannot take.
  it("declares the dimensions of multilingual-e5-small", () => {
    expect(setup().embedder.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  // Guards: the model's "query: " prefix missing (similar texts drift) and unbounded input reaching the runtime.
  it("prefixes every text and trims it to the useful length", async () => {
    const { fake, embedder } = setup();
    await embedder.embed(["short", "x".repeat(MAX_INPUT_CHARS * 3)], live());
    const sent = fake.calls.flat();
    expect(sent[0]).toBe("query: short");
    expect(sent[1]).toHaveLength("query: ".length + MAX_INPUT_CHARS);
  });

  // Guards: batching that reorders, drops or duplicates vectors.
  it("gives the same vectors for a batch as for the texts one by one", async () => {
    const texts = Array.from({ length: 7 }, (_, i) => `text ${i}`);
    const { embedder, fake } = setup({ batchSize: 3 });
    const batch = unwrap(await embedder.embed(texts, live()));
    const single = await Promise.all(
      texts.map(async (t) => unwrap(await embedder.embed([t], live()))[0]),
    );
    expect(batch.map((v) => [...v])).toEqual(single.map((v) => [...(v ?? [])]));
    expect(fake.calls.slice(0, 3).map((c) => c.length)).toEqual([3, 3, 1]);
  });

  // Guards: a cancelled scan that keeps embedding the rest of its batch.
  it("stops before the next batch when cancelled", async () => {
    const cancel = createCancelSource();
    const fake = createFakeFeatureExtractor();
    const embedder = createEmbedder({
      modelDir: async () => "e5",
      batchSize: 2,
      load: async (dir) => {
        const inner = await fake.loader(dir);
        return {
          ...inner,
          extract: async (texts) => {
            cancel.abort();
            return inner.extract(texts);
          },
        };
      },
    });
    const out = await embedder.embed(["a", "b", "c", "d", "e"], cancel.signal);
    expect(out.ok ? undefined : out.error.code).toBe("operation.cancelled");
    expect(fake.calls).toHaveLength(1);
    expect((await embedder.embed(["a"], aborted())).ok).toBe(false);
  });

  // Guards: a missing or crashing model escaping as an exception (the host must keep serving) or staying dead.
  it("answers unavailable without a model and recovers after a runtime failure", async () => {
    const missing = await setup({ modelDir: undefined }).embedder.embed(["a"], live());
    expect(missing.ok ? undefined : missing.error.code).toBe("ai.unavailable");

    const { fake, embedder } = setup();
    fake.failNextExtract();
    const failed = await embedder.embed(["a"], live());
    expect(failed.ok ? undefined : failed.error.code).toBe("ai.unavailable");
    expect((await embedder.embed(["a"], live())).ok).toBe(true);
  });
});
