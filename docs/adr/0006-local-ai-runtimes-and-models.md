# 0006 — Local AI runtimes and model selection

Status: Accepted (2026-11-17) · Amended by [0014](0014-store-reports-and-actions-not-mail.md): on-device learning was a kNN override over labeled examples; it is now rules keyed by sender hash

## Decision
- **Layers**, cheapest first: rules → decision heads (embeddings and calibrated classifiers) → generative LLM. Each decision stores its reason and confidence; all output is zod-validated.
- **Generative runtime**: `node-llama-cpp` 3.22.3 (GGUF; Metal on macOS, CPU elsewhere, [ADR 0018](0018-patched-llama-binary-test-and-cpu-only-v1.md)) in the model-host process ([ADR 0002](0002-electron-process-model-and-ipc.md)), with JSON-schema grammar-constrained decoding.
- **Embeddings and heads**: Transformers.js 4.3.2 on `onnxruntime-node`. Heads are small classifiers over embedding plus sender features, temperature-scaled on held-out data.
- **Models** (Apache-2.0 or MIT; benchmark in `packages/ai/bench/results/`):
  - Tier T2 (16 GB or more, GPU or Apple Silicon): Gemma 4 E4B-it, Q4_K_M (about 5 GB). Fallback: Qwen3.5-4B.
  - Tier T1 (8–16 GB): Qwen3.5-2B, Q4_K_M, for extraction and explanations only.
  - Embeddings: multilingual-e5-small (MIT).
  - Tier T0 (under 8 GB or no usable GPU): rules and heads only, explained in plain words.
- Multilingual is required: English, French and Japanese in every eval.
- **Speed**: classify per sender and per template cluster, minimum input first, content-hash cache, batched inference, bounded concurrency, power awareness: full speed plugged in, throttle on battery, pause on sleep.
- **On-device learning**: corrections become rules keyed by sender hash and type, replacing the former kNN override over labeled examples ([ADR 0014](0014-store-reports-and-actions-not-mail.md)); heads are re-fitted locally when idle.
- **Distribution**: models download on first launch from `huggingface.co` and its CDN hosts in `packages/net/src/egress/allowlist.ts` (exact names); resumable, SHA-256 verified, signed manifest.
- **Eval**: fixture mailbox and a labeled multilingual set; precision, recall and emails per minute per tier; CI fails on regression.
- **Packaging**: prebuilt binaries only; keep the target OS and arch of `onnxruntime-node`; `asarUnpack` native modules.

## Consequences
Rules carry the bulk on T0 machines, and Autopilot acts only above the calibrated threshold, so weak machines see fewer automatic actions.

## Known limits
The benchmark set is synthetic; rebuild the eval on realistic mail before calibrating thresholds. Models invent deadlines: prompts need a "no date" example and a date must appear in the source. x64 CPU numbers must be collected before tier thresholds are set and the tier rule is provisional: a CPU-only machine stays on T0 until a CPU path and an override exist. With `thoughtTokens: 0` on Qwen3.5, `node-llama-cpp` returns JSON without its opening `{`; a test must guard it.
