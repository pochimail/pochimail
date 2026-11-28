# 0016 — A few fixed email types, automatic topics

Status: Accepted (2026-11-19) · Changes: the seven fixed categories · Related: [ADR 0006](0006-local-ai-runtimes-and-models.md), [ADR 0012](0012-delete-moves-to-trash-with-approval.md)

## Context
The first design used seven hand-picked categories (People, Records, Purchases & travel, Sign-ins & security, Notifications, Newsletters, Promotions) and attached rules to them. Hand-picked names cannot fit every mailbox, and safety rules tied to names break when an email is misfiled. Fully automatic categories have the opposite problem: names drift between scans, small local models cluster poorly, results cannot be measured against a ground truth, they differ across languages, and no safety rule can rely on them.

## Decision
- **Type** (fixed, small, detected automatically): `personal` (written by a person to the user), `transactional` (receipts, bookings, statements, account and security messages), `notification` (automated updates), `newsletter`, `promotion`. Types drive actions: unsubscribe applies to newsletters and promotions, bulk archive and delete to automated types. Types are what the eval set measures.
- **Signals** (detected per email): needs a reply, waiting on them, time-sensitive, has a document, important sender, from a real person, user replied to sender, old and never opened. Signals drive protection ([ADR 0012](0012-delete-moves-to-trash-with-approval.md)) and Catch what matters.
- **Topics** (automatic, open-ended): discovered from the user's own mailbox by the local model (e.g. "Job search", "Kindergarten", "Amazon orders"), named in the user's language, stable once created (the user can rename, merge or hide them). Topics organize: the sidebar, Review groupings and provider labels.
- The UI shows only types and topics that contain email for the current selection.
- Addendum (2026-11-26, #291), replacing the line above: every type and every topic is listed with its count; an empty one is muted, not hidden.

## Consequences
- Safety and actions rest on a small, testable set; organization adapts to each mailbox.
- The classifier, fixtures, eval set, sidebar and copy move from seven categories to five types plus topics.
- Topic discovery needs its own quality bar (stability across scans, no duplicate topics).

## Alternatives considered
- Keep the seven fixed categories: rejected; too rigid, and safety tied to names.
- Fully automatic categories only: rejected; unstable and untestable, nothing to attach safety rules to.
