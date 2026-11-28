import { AiUnavailable } from "@pochimail/classification/errors";
import type { AiError, Embedder } from "@pochimail/classification/ports/classifier";
import type { AsyncResult } from "@pochimail/kernel/common";
import { Cancelled } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import { createLimiter } from "../limiter.ts";
import type { FeatureExtractor, LoadExtractor } from "./feature-extractor.ts";

export interface EmbedderOptions {
  load: LoadExtractor;
  /** The model folder, or `undefined` when it is not on disk (the embedder then answers `AiUnavailable`). */
  modelDir: () => Promise<string | undefined>;
  /** Texts run through the model together. Default 16. */
  batchSize?: number;
  /** Batches that run at once. Default 1. */
  concurrency?: number;
}

/** multilingual-e5-small (ADR 0006). */
export const EMBEDDING_DIMENSIONS = 384;
/** Characters kept per text: past this the model's 512-token window is full for any script we support. */
export const MAX_INPUT_CHARS = 1000;
/** The model was trained on prefixed text; without it similar texts drift apart. */
const PREFIX = "query: ";

/**
 * Embeddings for every tier. Vectors are returned to the caller and kept nowhere here: not on disk, not in a log
 * (ADR 0014). Cancelling stops before the next batch.
 */
export const createEmbedder = (options: EmbedderOptions): Embedder => {
  const batchSize = options.batchSize ?? 16;
  const limiter = createLimiter(options.concurrency ?? 1);
  let extractor: Promise<FeatureExtractor | undefined> | undefined;

  const load = (): Promise<FeatureExtractor | undefined> => {
    extractor ??= (async () => {
      const dir = await options.modelDir();
      if (dir === undefined) return undefined;
      try {
        return await options.load(dir);
      } catch {
        return undefined;
      }
    })().then((loaded) => {
      if (loaded === undefined) extractor = undefined;
      return loaded;
    });
    return extractor;
  };

  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts, signal): AsyncResult<readonly Float32Array[], AiError> {
      if (signal.aborted) return err(new Cancelled());
      const loaded = await load();
      if (loaded === undefined) return err(new AiUnavailable());
      const inputs = texts.map((text) => PREFIX + text.slice(0, MAX_INPUT_CHARS));
      const vectors: Float32Array[] = [];
      for (let from = 0; from < inputs.length; from += batchSize) {
        const ran = await limiter
          .run(signal, () => loaded.extract(inputs.slice(from, from + batchSize)))
          .catch(() => undefined);
        if (ran === undefined) {
          // The runtime may be broken: free its native memory now, the next request loads a fresh one.
          extractor = undefined;
          void loaded.dispose().catch(() => {});
          return err(new AiUnavailable());
        }
        if (!ran.ok || signal.aborted) return err(new Cancelled());
        vectors.push(...ran.value);
      }
      return ok(vectors);
    },
  };
};
