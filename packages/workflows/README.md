# @pochimail/workflows

## Why this package exists
Shared package.
The only place domains meet: it turns one domain's events into another's commands, so domains stay independent.

## Owns
- Scan (sync → classify → recommend), apply (action applied → refresh reports), notifications on completion; scans slow down on battery and pause on sleep or low power; after the first scan each account is polled for new mail on the adaptive cadence, one sync at a time per account.

## May import
Domain packages, `pipeline`, `kernel`, `logger`. Tests use the domains' `./testing` exports.

## Must not contain
- Business rules, adapters, UI.
