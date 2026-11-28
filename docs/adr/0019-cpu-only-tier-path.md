# 0019 — CPU-only tier path, decided by measured speed

Status: Accepted (2026-11-26) · Amends: [0006](0006-local-ai-runtimes-and-models.md). Thresholds are provisional.

## Context
ADR 0006 put every machine without a usable GPU on T0. ADR 0018 makes Linux and Windows CPU-only in v1, so the CPU decides.

## Decision
- **Rule** (`detectTier`, pure over a hardware report): under 8 GB is T0. An accelerator counts on Apple Silicon, or when it measures 1.5 times the CPU; otherwise the CPU-only path applies. Accelerated: T2 from 16 GB, else T1.
- **CPU-only**: T0 under 15 GiB (a "16 GB" machine reports about 15.5), without AVX2, or under **8 tokens/s** or unmeasured. Else T1. T2 needs **30 tokens/s**: Gemma 4 E4B decodes at half the T1 model's speed, and 15 tokens/s is a usable T2.
- **Speed** is the T1 model's decode speed, estimated with no model: a 1.5 s benchmark in the model host streams int8 weights through a dot product on every core (best of three rounds), times 7. Decode is memory-bound, so bandwidth predicts it; the factor is fitted on the machines below.
- **AVX2** comes from llama.cpp's flags line (`systemInfo`); `null` on Arm, where speed alone decides.
- **Isolation**: the probe and the benchmark run in the model host, never the worker (dependency-cruiser). A throw or a 10 s wait is a failed probe. A crash or hang kills the model host; the stored detection says the probe started, so the next launch reads `crash` and does not retry until the hardware changes or the user re-detects. A failed probe means CPU-only.
- **Reasons**, one message per detection with the tier and speed, nothing else: `no-prebuilt-binary`, `no-vulkan-loader`, `driver-error`, `virtual-display`, `crash`, `timeout`, `unknown`.
- **Not measured**: no v1 backend times an accelerator (ADR 0018), so Vulkan and CUDA do not count until one does.

## Measured
`packages/ai/bench/results/`, CPU only:

| Machine | Qwen3.5-2B | Gemma 4 E4B | Estimate |
|---|---|---|---|
| Linux x64, 4 cores, 16 GB | 13.7 | 7.1 | 11.6 |
| Windows x64, 4 cores, 16 GB | 21.9 | 10.0 | 15.0 |
| macOS x64, 4 cores, 14 GB | 9.9 | 7.7 | 11.8 |
| M2 Pro | 68.9 | n/a | 72 |

Not measured: a CPU without AVX2, a weak integrated GPU, fewer than 4 cores.

## Consequences
A fast 16 GB laptop gets the T1 model without a GPU.
