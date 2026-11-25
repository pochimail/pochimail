# @pochimail/ci

## Why this package exists
Repository checks that the standard tools do not cover, run by `pnpm check` and CI.

## Owns
- `assert-gates`: fails a gate that runs zero tasks.
- `check-quality` + `quality-rules`: file length, design-scale and breakpoint discipline, color literals, deep relative imports, to-do markers without an issue number, and package READMEs, with a baseline that may only shrink (`quality-baseline.json`).
- `make-mascot-rim` (`pnpm mascot:rim`): regenerates the night pose's rim mask from its art; a test fails when the committed mask is stale.

## May import
`node:*` only.

## Must not contain
- Product code or anything imported by apps or packages.
