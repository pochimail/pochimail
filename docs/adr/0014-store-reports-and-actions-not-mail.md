# 0014 — Store reports and actions, not mail data

Status: Accepted (2026-11-19) · Supersedes: [ADR 0009](0009-store-metadata-not-mail.md) · Amends: [ADR 0005](0005-local-storage.md)

## Context
ADR 0009 kept message metadata at rest: subjects, snippets, sender addresses, unsubscribe headers, embeddings and a full-text index. Pochimail is not a mail client; it only needs to know what it found and what it did. Anything else at rest is a liability.

## Decision
- **Persisted:** provider message and thread ids; category, confidence and reason code; signal type and dates; size; date; flags and labels Pochimail set; a keyed hash of the sender (HMAC; the key lives in the OS keychain) for per-sender statistics and Keep rules; aggregate scan reports (counts, sizes, categories, recommendations); the action log (what, when, ids, inverse, outcome); sync cursors; settings; destinations of saved documents.
- **Never persisted:** subjects, snippets, bodies, sender or recipient names and addresses in clear text, attachment names, unsubscribe URLs, content embeddings.
- Display fields and unsubscribe headers are fetched from the provider when a screen or an action needs them, in batches, and kept in memory only.
- The full-text index is removed. Re-classification after a model update re-fetches headers within provider quotas. On-device learning is stored as rules keyed by sender hash and category.
- The database stays encrypted at rest.

## Consequences
- A stolen database reveals counts, ids and dates, not what anyone wrote or who they are.
- Review lists fetch their rows from the provider, so they need a connected account; without one they show counts.
- A schema allow-list test fails if a column outside this list is added; a fixture test checks that no fixture text reaches the database file.

## Alternatives considered
- Keep metadata (ADR 0009): rejected for privacy.
- Store nothing between sessions: rejected; reports, undo and incremental sync need state.
