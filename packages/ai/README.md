# @pochimail/ai

## Why this package exists
Adapter package.
Local models behind the classification ports: types, signals, topics (ADR 0006, 0016).

## Owns
- Model manifest, resumable SHA-256-verified downloads (`ModelStore`), hardware tiers T0/T1/T2, inference per tier, output validation, `bench/` (dev only).

## May import
`@pochimail/classification` (port types), `kernel`, `logger`, model runtimes.

## Must not contain
- Network inference, business rules, or its own HTTP: downloads go through an injected `ModelTransport` (`net`'s model downloader), so every byte passes the egress allow-list.
