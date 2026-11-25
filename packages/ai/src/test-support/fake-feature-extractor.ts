import { EMBEDDING_DIMENSIONS } from "../embeddings/embedder.ts";
import type { FeatureExtractor } from "../embeddings/feature-extractor.ts";

export interface FakeFeatureExtractor {
  readonly loader: (modelDir: string) => Promise<FeatureExtractor>;
  /** Each call's texts, as the model would see them. */
  readonly calls: string[][];
  failNextExtract(): void;
}

/** A character hash spread over the model's dimensions, normalised: the same text gives the same vector, and only that text. */
const vectorOf = (text: string): Float32Array => {
  const v = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < text.length; i++) {
    const slot = (text.charCodeAt(i) * 31 + i) % EMBEDDING_DIMENSIONS;
    v[slot] = (v[slot] ?? 0) + 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};

export const createFakeFeatureExtractor = (): FakeFeatureExtractor => {
  const calls: string[][] = [];
  let fails = false;
  return {
    calls,
    failNextExtract: () => {
      fails = true;
    },
    loader: async () => ({
      async extract(texts) {
        calls.push([...texts]);
        if (fails) {
          fails = false;
          throw new Error("extract failed");
        }
        return texts.map(vectorOf);
      },
      async dispose() {},
    }),
  };
};
