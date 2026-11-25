import { access } from "node:fs/promises";
import { availableMemory } from "node:process";
import { createEmbedder } from "@pochimail/ai/embeddings/embedder";
import { loadTransformersExtractor } from "@pochimail/ai/embeddings/transformers-extractor";
import { createLlamaRuntime } from "@pochimail/ai/llm/llama-runtime";
import { createLlmProvider } from "@pochimail/ai/llm/llm-provider";
import type { ModelHostEngine } from "./serve.ts";

/** Where the model files are. Until the downloader lands (#281) the owner points the host at them. */
export interface ModelPaths {
  /** A GGUF file for the generative model. */
  readonly llmModel: string | undefined;
  /** A folder with multilingual-e5-small in Transformers.js layout. */
  readonly embeddingModelDir: string | undefined;
}

/** The idle model is unloaded when less than this is free (a loaded model is several GB). */
const LOW_MEMORY_BYTES = 256 * 1024 * 1024;
const MEMORY_CHECK_MS = 30_000;

/** `undefined` when the path is not set or nothing is there: the provider then answers `unavailable`. */
const present = (path: string | undefined) => async (): Promise<string | undefined> => {
  if (path === undefined) return undefined;
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
};

/** The real generative model and embedder. Nothing loads until the first request. No classifier yet (M3). */
export const createLocalEngine = (paths: ModelPaths): ModelHostEngine => {
  const llm = createLlmProvider({
    runtime: createLlamaRuntime(),
    modelPath: present(paths.llmModel),
  });
  const embedder = createEmbedder({
    load: loadTransformersExtractor,
    modelDir: present(paths.embeddingModelDir),
  });
  setInterval(() => {
    if (availableMemory() < LOW_MEMORY_BYTES) void llm.unload();
  }, MEMORY_CHECK_MS).unref();
  return { llm, embedder };
};
