# @pochimail/classification

## Why this package exists
Domain package.
Understanding each email: its category, signals and the reason and confidence behind them (topics follow in ADR 0016).

## Owns
- The seven categories until the types-and-topics model replaces them, signal kinds, derived data (`DerivedMessage`), stored signals.
- Ports: `Classifier`, `Embedder`, `LlmProvider`, derived and signal repositories, plain-data message and signal-facts sources, `ClassificationUnitOfWork`.
- `ClassifyBatch`, `DetectSignals`, `EvaluateSignals`, `EvaluateSuspicious`, `CountCategories`, the signal and suspicious rules, the signal age windows (`SignalSettings`), and the `MessageClassified` and `SignalDetected` events.
- An in-memory adapter, fakes, and contract suites under `./testing/*`.

## May import
`@pochimail/kernel`, `zod`.

## Must not contain
- Model runtimes (they live in `packages/ai`), recommendations, actions, another domain's types: its data arrives through the plain-data ports.
