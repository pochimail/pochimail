import { createCachingClassifier } from "@pochimail/ai/cache";
import { demoScale } from "../shared/demo.ts";
import type { ModelHostEngine } from "./serve.ts";

/** Demo (dev/E2E) fixture stubs from `@pochimail/testing`; no real model exists before M3, so production gets none. */
export const loadEngine = async (
  demo: string | undefined,
): Promise<ModelHostEngine | undefined> => {
  const scale = demoScale(demo);
  if (scale === undefined) return undefined;
  const { createFixtureEngine } = await import("./fixture-engine.ts");
  const engine = createFixtureEngine(scale);
  // One cache per host process, in memory only: it is gone when the host exits (ADR 0014).
  return { ...engine, classifier: createCachingClassifier(engine.classifier) };
};
