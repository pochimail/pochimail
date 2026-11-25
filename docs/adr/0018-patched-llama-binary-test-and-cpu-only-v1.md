# 0018 — Patched llama binary test, and CPU-only v1

Status: Accepted (2026-11-26) · Amends: [ADR 0006](0006-local-ai-runtimes-and-models.md)

## Context
`node-llama-cpp` tests every prebuilt binary in a forked child process before it loads it. In an Electron utility process that fork needs the `runAsNode` fuse, which ADR 0002 keeps off. On Linux, and on Windows with a GPU backend, `getLlama` ended in `NoBinaryFoundError` and the model was unavailable. Turning the fuse on would let any process run as Node, and a fork that relaunches the app starts a second instance on the same database.

## Decision
- **Patch.** `pnpm patch` of `node-llama-cpp` 3.22.3 (`patches/`, `patchedDependencies` in `pnpm-workspace.yaml`): `testBindingBinary` returns true when `process.type === "utility"`. The packaged smoke loads the binary in a utility process on every OS, so a broken binary fails CI; at run time a crash is a model host crash, which the supervisor restarts (ADR 0002).
- **When a patch is allowed.** Only when no option, fuse or setting does the job; a few lines; pinned to one exact version; a comment says why; a test or the smoke proves it. Drop it when upstream supports the case. A version bump fails the install until the patch is made again.
- **CPU-only on Linux and Windows in v1.** `gpu: false`; the Vulkan and CUDA packages are not shipped. macOS uses Metal and falls back to the CPU.

## Consequences
Generation is slower on Linux and Windows machines that have a GPU. Tier thresholds and eval numbers for them must be measured on the CPU. Installers are smaller. A GPU backend returns per OS once it has its own smoke and an installer size budget.
