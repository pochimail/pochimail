# @pochimail/cleanup

## Why this package exists
Domain package.
Deciding what to propose: suggestions, protection (ADR 0012), the digest and the Overview figures.

## Owns
- `Suggestion` with its own recommendation kinds (archive, delete, unsubscribe, label, save), `Digest`, the cleanable-type and protecting-signal policies.
- Ports: suggestion and digest-state repositories, plain-data `MailboxFacts`, `CleanupUnitOfWork`.
- `ProposeSuggestions`, `SummarizeMailbox`, `BuildDigest`, `LatestDigest`, `GetOverview`, and the `SuggestionCreated`, `SuggestionApproved` and `DigestReady` events.
- An in-memory adapter and contract suites under `./testing/*`.

## May import
`@pochimail/kernel`, `zod`.

## Must not contain
- Applying actions (that is `actions`), provider or storage code, another domain's types: types and signal kinds arrive as plain labels.
