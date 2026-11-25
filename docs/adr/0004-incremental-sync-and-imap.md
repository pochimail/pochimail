# 0004 — Incremental sync and wake-ups

Status: Accepted (2026-11-17) · Amended by [0011](0011-v1-providers-google-and-microsoft.md): v1 has Gmail only; Microsoft and the IMAP parts return in v1.1

## Decision
**One `MailProvider` port, one adapter per provider**, each declaring capabilities (`labels` or `folders`, archive semantics, `batchModify`, `deltaSync`, `pushWakeups`, `unsubscribeSend`).

| Provider | Source | Cursor | Archive / organize |
|---|---|---|---|
| Gmail | Gmail API (`history.list`, batch endpoints) | `historyId`; full re-list when expired (404) | remove the `INBOX` label; labels |
| Microsoft (v1.1) | Graph (`/messages/delta`, `$batch`) | delta token per folder; keep a full-walk fallback | move to Archive; Outlook categories |
| IMAP (v1.1) | `imapflow` and `mailparser` | `UIDVALIDITY` + `HIGHESTMODSEQ`, UID-range fallback | move to the `\Archive` folder; keywords or `Pochimail/` folders |

- Headers first. Anything else is fetched when a screen or action needs it and kept in memory only ([ADR 0014](0014-store-reports-and-actions-not-mail.md)).
- **Wake-ups are adaptive polling** of the delta APIs: about 1 min while the window is focused, 5 min visible and idle, the Keep it tidy cadence when hidden; paused on sleep, offline or battery saver. IDLE is not used in v1 (IMAP returns in v1.1, [ADR 0011](0011-v1-providers-google-and-microsoft.md)); Gmail IDLE stays opt-in when it returns.
- **Rate limits**: per-account token bucket (Gmail counts quota units, not requests: 6,000 units/min/user; `messages.get` 20, `batchModify` 50), honor `Retry-After`, exponential backoff with jitter, and a `RateLimited{resumeAt}` state for the UI. Graph `$batch` holds at most 20 requests, each throttled separately.
- **Resumability**: cursors and page tokens persist in the job payload, so a restart resumes mid-backfill.
- **First sync** walks newest to oldest so the Overview fills with recent mail first.
- An optional privacy relay for Gmail Pub/Sub and Graph webhooks stays v1.x, off by default.

## Consequences
The network allow-list contains only the hosts of connected providers. The UI shows real progress, since a first sync of a large mailbox takes hours.

## v1.1 (IMAP)
Provider presets (Yahoo, iCloud, Fastmail, GMX…) come from a bundled snapshot of Thunderbird's ISPDB (no runtime lookup), keeping original headers and adding a third-party notice. Yahoo starts with an app password; iCloud uses an app-specific password only. IMAP has no labels, so "Organize" uses keywords or folders and the UI says which.

## Alternatives considered
IMAP IDLE for Gmail and Microsoft (scope too broad).
