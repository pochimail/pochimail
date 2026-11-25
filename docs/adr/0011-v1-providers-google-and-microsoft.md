# 0011 — v1 providers: Gmail; Outlook and IMAP in v1.1

Status: Accepted (2026-11-19), narrowed 2026-11-25 · Amends: [ADR 0004](0004-incremental-sync-and-imap.md)

Narrowed 2026-11-25 by the owner ([#302](https://github.com/pochimail/pochimail/issues/302)): v1 ships **Gmail only**. Outlook / Microsoft 365 (Microsoft Graph) moves to **v1.1** together with IMAP. The `graph` adapter stays in the repository, unreleased, until then. The lines below keep the earlier decision as history.

Superseded 2026-11-21 for the Connect screen only: Microsoft sign-in is deferred until the Graph adapter lands, so the screen offers Google alone. The v1 provider architecture above is unchanged; this is a rollout note, not a reversal of the decision.

## Context
Each provider adds an adapter, a sign-in flow, recorded fixtures, network hosts and support load. Gmail and Outlook/Microsoft 365 cover most users, and both offer true delta sync and OAuth. Generic IMAP (Yahoo, iCloud, others) needs app passwords, a provider picker and a separate sync strategy.

## Decision
- v1 supports **Gmail** (Gmail API) only. Outlook / Microsoft 365 (Microsoft Graph) comes in **v1.1** (earlier decision: v1 with both).
- IMAP accounts (generic and presets) also move to **v1.1**. IMAP-only code, fixtures, test harnesses, hosts and copy are removed from v1 and return with v1.1.
- The `MailProvider` port keeps its capability flags (organization model, archive semantics, batch size, delta sync, push wake-ups) so IMAP can be added as one more adapter without changing any domain.

## Consequences
- Smaller v1: one released adapter, one sign-in pattern (OAuth PKCE), a shorter network allow-list.
- Users of other providers, Outlook included, wait for v1.1; the Connect screen says so.

## Alternatives considered
- IMAP in v1: rejected for scope; it delays the first usable release.
