# @pochimail/classification

## Why this package exists
Domain package.
Understanding each email: its type, signals and topics, and the reason and confidence behind them (ADR 0016).

## Owns
- The five email types (the stored `category` label holds one, ADR 0014), signal kinds, topics, derived data (`DerivedMessage`), stored signals.
- Ports: `Classifier`, `Embedder`, `LlmProvider`, `TopicDiscoverer`, derived, signal and topic repositories, plain-data message and signal-facts sources, `ClassificationUnitOfWork`.
- `ClassifyBatch`, `DiscoverTopics`, `DetectSignals`, `EvaluateSignals`, `EvaluateSuspicious`, `CountTypes`, `CountTopics`, the signal and suspicious rules, the signal age windows (`SignalSettings`), and the `MessageClassified` and `SignalDetected` events.
- An in-memory adapter, fakes, and contract suites under `./testing/*`.

## May import
`@pochimail/kernel`, `zod`.

## Must not contain
- Model runtimes (they live in `packages/ai`), recommendations, actions, another domain's types: its data arrives through the plain-data ports.
