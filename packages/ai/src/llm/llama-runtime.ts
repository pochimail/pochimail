import type { Llama } from "node-llama-cpp";
import { type JsonSchema, type LlmRuntime, RequestRejected } from "./llm-runtime.ts";

const CONTEXT_TOKENS = 2048;

type GrammarSchema = Parameters<Llama["createGrammarForJsonSchema"]>[0];
export type Library = typeof import("node-llama-cpp");

/**
 * node-llama-cpp with prebuilt binaries only (never a source build in a packaged app). macOS uses Metal when it works
 * and falls back to the CPU; Linux and Windows are CPU-only in v1 (ADR 0006).
 */
export const startLlama = async (
  { getLlama }: Library,
  platform: NodeJS.Platform = process.platform,
): Promise<Llama> => {
  const options = { build: "never", progressLogs: false } as const;
  if (platform !== "darwin") return getLlama({ ...options, gpu: false });
  try {
    return await getLlama(options);
  } catch {
    return getLlama({ ...options, gpu: false });
  }
};

const grammarFor = async (llama: Llama, jsonSchema: JsonSchema) => {
  try {
    return await llama.createGrammarForJsonSchema(jsonSchema as GrammarSchema);
  } catch {
    throw new RequestRejected();
  }
};

/** The library is imported on first use, so a host that never loads a model never touches the native binding. */
export const createLlamaRuntime = (): LlmRuntime => ({
  async load(modelPath, sequences) {
    const library = await import("node-llama-cpp");
    const llama = await startLlama(library);
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: CONTEXT_TOKENS, sequences });
    return {
      async generate({ system, prompt, maxTokens, jsonSchema }, signal) {
        const grammar = jsonSchema === undefined ? undefined : await grammarFor(llama, jsonSchema);
        const sequence = context.getSequence();
        const session = new library.LlamaChatSession({
          contextSequence: sequence,
          ...(system === undefined ? {} : { systemPrompt: system }),
        });
        try {
          return await session.prompt(prompt, {
            ...(grammar === undefined ? {} : { grammar }),
            temperature: 0,
            maxTokens,
            budgets: { thoughtTokens: 0 },
            signal,
            stopOnAbortSignal: true,
          });
        } finally {
          session.dispose({ disposeSequence: false });
          await sequence.dispose();
        }
      },
      async dispose() {
        await context.dispose();
        await model.dispose();
        await llama.dispose();
      },
    };
  },
});
