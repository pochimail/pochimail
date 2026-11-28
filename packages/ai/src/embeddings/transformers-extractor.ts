import { basename, dirname } from "node:path";
import type { LoadExtractor } from "./feature-extractor.ts";

/**
 * Transformers.js on onnxruntime-node, CPU, `q8` weights, mean pooling, normalised. Files come from a local folder only:
 * remote model loading is off, because every download goes through `net` (ADR 0006). The library is imported on first
 * use: importing it loads the native binding, and a host that never embeds should not pay for that or fail on it.
 */
export const loadTransformersExtractor: LoadExtractor = async (modelDir) => {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = dirname(modelDir);
  const extractor = await pipeline("feature-extraction", basename(modelDir), {
    dtype: "q8",
    device: "cpu",
  });
  return {
    // One text per model call: `q8` quantises activations per tensor, so a padded batch moves every vector by about 0.2%
    // cosine and the same text would score differently next to different neighbours.
    async extract(texts) {
      const vectors: Float32Array[] = [];
      for (const text of texts) {
        const out = await extractor(text, { pooling: "mean", normalize: true });
        vectors.push(Float32Array.from(out.data as Float32Array));
      }
      return vectors;
    },
    async dispose() {
      await extractor.dispose();
    },
  };
};
