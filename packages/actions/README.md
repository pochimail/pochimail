# @pochimail/actions

## Why this package exists
Domain package.
Changing mailboxes safely: apply, log, undo (ADR 0012, 0013).

## Owns
- `Action`, `ActionLog` (pending → applied/failed, inverse), apply, undo, resolve pending after a crash, unsubscribe, Autopilot and authorization policies.
- Ports: mail commands (archive, trash, restore, label, unsubscribe), action log repository. Events: action applied, undone.

## May import
`@pochimail/kernel`, `zod`.

## Must not contain
- Deciding what to propose (that is `cleanup`), provider details.
