# @pochimail/ai

## Why this package exists
Adapter package.
Local models behind the classification ports: types, signals, topics (ADR 0006, 0016).

## Owns
- Model manifest, resumable SHA-256-verified downloads (`ModelStore`), hardware tiers T0/T1/T2, inference per tier, output validation, `bench/` (dev only).
- The generative provider (`llm/`: node-llama-cpp, JSON-schema decoding) and the embedder (`embeddings/`: multilingual-e5-small, Transformers.js). Both load on first use and answer `AiUnavailable` if their model is missing.
- Real-model tests, skipped unless `POCHIMAIL_LLM_MODEL` and `POCHIMAIL_EMBEDDING_MODEL_DIR` are set.
- The classification cache (`src/cache.ts`): answers by content hash, in memory only, never persisted (ADR 0014).

## May import
`@pochimail/classification` (port types), `kernel`, `logger`, model runtimes.

## Must not contain
- Network inference, business rules, or its own HTTP: downloads use an injected `ModelTransport` (`net`'s downloader), so every byte passes the egress allow-list.
- Anything that logs, stores or caches a prompt, an answer or a vector (ADR 0014).
