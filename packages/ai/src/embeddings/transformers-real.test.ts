import { embedderContract } from "@pochimail/classification/testing/ai-contract";
import { live } from "@pochimail/classification/testing/samples";
import { unwrap } from "@pochimail/kernel/result";
import { afterAll, describe, expect, it } from "vitest";
import { createEmbedder } from "./embedder.ts";
import { loadTransformersExtractor } from "./transformers-extractor.ts";

// Opt-in: set POCHIMAIL_EMBEDDING_MODEL_DIR to a folder with multilingual-e5-small in Transformers.js layout
// (config.json, tokenizer files, onnx/model_quantized.onnx). Skipped in CI, which has no model.
const modelDir = process.env.POCHIMAIL_EMBEDDING_MODEL_DIR;

const cosine = (a: Float32Array, b: Float32Array): number =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

describe.skipIf(modelDir === undefined)("real embeddings", () => {
  const embedder = createEmbedder({
    load: loadTransformersExtractor,
    modelDir: async () => modelDir,
  });
  afterAll(() => undefined);

  embedderContract(() => embedder);

  // Guards: the same text drifting between runs, so duplicate detection and caches miss.
  it("repeats a vector within 1e-5", async () => {
    const [a, b] = unwrap(
      await embedder.embed(["Your invoice is ready", "Your invoice is ready"], live()),
    );
    expect(Math.max(...(a ?? []).map((x, i) => Math.abs(x - (b?.[i] ?? 0))))).toBeLessThan(1e-5);
  });

  // Guards: padding in a batch changing a vector, so a text scores differently depending on its neighbours.
  it("gives a batch the same vectors as single calls within 1e-4", async () => {
    const texts = [
      "Your invoice is ready",
      "Votre facture est prête",
      "請求書の準備ができました",
      "x",
    ];
    const batch = unwrap(await embedder.embed(texts, live()));
    for (const [i, text] of texts.entries()) {
      const [single] = unwrap(await embedder.embed([text], live()));
      expect(cosine(batch[i] ?? new Float32Array(), single ?? new Float32Array())).toBeGreaterThan(
        1 - 1e-4,
      );
    }
  });

  // Guards: a model that is not multilingual, so French and Japanese mail never groups with its English twin.
  it.each([
    [
      "English",
      "Your package has shipped and arrives on Friday",
      "Your parcel was sent and will arrive Friday",
    ],
    [
      "French",
      "Votre colis a été expédié et arrive vendredi",
      "Votre commande est partie et arrivera vendredi",
    ],
    [
      "Japanese",
      "お荷物を発送しました。金曜日に届きます",
      "ご注文の商品を発送しました。金曜日にお届けします",
    ],
  ])("puts %s near-duplicates closer than unrelated text", async (_language, a, b) => {
    const unrelated = "Quarterly tax statement for your savings account";
    const [va, vb, vu] = unwrap(await embedder.embed([a, b, unrelated], live()));
    expect(cosine(va as Float32Array, vb as Float32Array)).toBeGreaterThan(
      cosine(va as Float32Array, vu as Float32Array),
    );
  });
});
