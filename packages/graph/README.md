# @pochimail/graph

## Why this package exists
Adapter package.
Outlook and Microsoft 365 through Microsoft Graph, shipping in v1.1 (v1 is Gmail only), behind the accounts, mailbox, actions and documents ports.

## Owns
- Delta sync, header fetch, categories, archive folder, Deleted Items and restore, attachments, unsubscribe headers.

## May import
Domain packages (port types), `net`, `kernel`, `logger`, `zod`.

## Must not contain
- Gmail code, storage, business rules.
