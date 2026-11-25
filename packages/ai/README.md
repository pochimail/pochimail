# @pochimail/ai

## Why this package exists
Adapter package.
Local models behind the classification ports: types, signals, topics (ADR 0006, 0016).

## Owns
- Model manifest, resumable SHA-256-verified downloads (`ModelStore`), hardware tiers T0/T1/T2, inference per tier, output validation, `bench/` (dev only).
- The generative provider (`llm/`: node-llama-cpp, JSON-schema decoding, zod-parsed output) and the embedder (`embeddings/`: multilingual-e5-small on Transformers.js). Both load on first use, take their model path from the caller and answer `AiUnavailable` when it is missing.
- Real-model tests, opt-in: set `POCHIMAIL_LLM_MODEL` (a Qwen3.5 GGUF file) and `POCHIMAIL_EMBEDDING_MODEL_DIR` (multilingual-e5-small, Transformers.js layout); without them they skip.
- The classification cache (`src/cache.ts`): answers by content hash, in the model host's memory only, never persisted (ADR 0014).

## May import
`@pochimail/classification` (port types), `kernel`, `logger`, model runtimes (`node-llama-cpp`, `@huggingface/transformers`, `onnxruntime-node`).

## Must not contain
- Network inference, business rules, or its own HTTP: downloads go through an injected `ModelTransport` (`net`'s model downloader), so every byte passes the egress allow-list.
- Anything that logs, stores or caches a prompt, an answer or a vector (ADR 0014).
