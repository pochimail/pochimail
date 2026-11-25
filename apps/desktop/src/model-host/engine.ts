import { demoScale } from "../shared/demo.ts";
import type { ModelHostEngine } from "./serve.ts";

/**
 * Demo (dev/E2E) fixture stubs from `@pochimail/testing`, or the local models when their paths are set. With neither,
 * there is no engine and every request is answered `unavailable`.
 */
export const loadEngine = async (env: {
  POCHIMAIL_DEMO?: string | undefined;
  POCHIMAIL_LLM_MODEL?: string | undefined;
}): Promise<ModelHostEngine | undefined> => {
  const scale = demoScale(env.POCHIMAIL_DEMO);
  if (scale !== undefined) {
    const { createFixtureEngine } = await import("./fixture-engine.ts");
    return createFixtureEngine(scale);
  }
  if (env.POCHIMAIL_LLM_MODEL === undefined) return undefined;
  const { createLocalEngine } = await import("./local-engine.ts");
  return createLocalEngine({ llmModel: env.POCHIMAIL_LLM_MODEL });
};
