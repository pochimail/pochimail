import { createCachingClassifier } from "@pochimail/ai/cache";
import { demoScale } from "../shared/demo.ts";
import type { ModelHostEngine } from "./serve.ts";

/**
 * Demo (dev/E2E) fixture stubs from `@pochimail/testing`, or the local models when their paths are set. With neither,
 * there is no engine and every request is answered `unavailable`.
 */
export const loadEngine = async (env: {
  POCHIMAIL_DEMO?: string | undefined;
  POCHIMAIL_LLM_MODEL?: string | undefined;
  POCHIMAIL_EMBEDDING_MODEL_DIR?: string | undefined;
}): Promise<ModelHostEngine | undefined> => {
  const scale = demoScale(env.POCHIMAIL_DEMO);
  if (scale !== undefined) {
    const { createFixtureEngine } = await import("./fixture-engine.ts");
    const engine = createFixtureEngine(scale);
    // One cache per host process, in memory only: it is gone when the host exits (ADR 0014).
    const cache = createCachingClassifier(engine.classifier);
    return { ...engine, classifier: cache, clearCache: cache.clear };
  }
  if (env.POCHIMAIL_LLM_MODEL === undefined && env.POCHIMAIL_EMBEDDING_MODEL_DIR === undefined)
    return undefined;
  const { createLocalEngine } = await import("./local-engine.ts");
  return createLocalEngine({
    llmModel: env.POCHIMAIL_LLM_MODEL,
    embeddingModelDir: env.POCHIMAIL_EMBEDDING_MODEL_DIR,
  });
};
