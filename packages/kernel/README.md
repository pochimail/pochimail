# @pochimail/kernel

## Why this package exists
Shared package.
The few types every domain needs to speak the same language, and nothing more.

## Owns
- The `UNSURE_BELOW` confidence under which a classifier answer is unsure and the email protected (ADR 0012).
- `Result`, `Clock`, `IdGenerator`, async and cancel types, `Page`.
- Branded ids shared by domains (workspace, account, message, thread, topic) and their zod schemas.
- The base domain error plus storage, not-found, invalid-state and provider failures, and the `ERROR_CODES` registry (the one cross-domain list: the logger and every adapter must recognise a code).
- The event envelope, `defineEvent` and the `EventSink` port; generic contract helpers under `./testing/*`.

## May import
`zod`.

## Must not contain
- Anything specific to one domain, apart from `ERROR_CODES`. A type used by one domain belongs in that domain.
