# @pochimail/mailbox

## Why this package exists
Domain package.
Knowing what is in each mailbox: sync into the minimal message record of ADR 0014.

## Owns
- `IncomingMessage`, `Message` (the label is an opaque string), `Thread`, `SenderStats`, sync cursors.
- Ports: `MailReader` (sync, body on demand), message, thread, sender and cursor repositories, `MailboxUnitOfWork`.
- `StoreMessages`, `UpsertThreads`, the incoming-message sanitizer, and the `MessagesUpserted` and `SyncBatchFetched` events.
- Focused/visible poll-cadence constants in policies/poll-cadence.ts (@pochimail/mailbox/policies/poll-cadence): 60s focused, 300s visible.
- An in-memory adapter and contract suites under `./testing/*`.

## May import
`@pochimail/kernel`, `zod`.

## Must not contain
- Classification, recommendations or actions; any persisted content field.
