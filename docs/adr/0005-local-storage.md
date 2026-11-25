# 0005 — Local storage and encryption at rest

Status: Accepted (2026-11-17) · Amended by [0014](0014-store-reports-and-actions-not-mail.md) (what is stored; no FTS); blob store by [0010](0010-saved-attachments-go-to-user-storage.md)

## Decision
- **SQLite with SQLCipher-compatible encryption** through `better-sqlite3-multiple-ciphers`, pinned `13.1.1`; it ships Node-API prebuilds. WAL mode, `foreign_keys=ON`, one writer (the worker).
- **Key**: a random 256-bit key generated at first launch, stored with Electron `safeStorage` (Keychain, DPAPI, libsecret), async only. On Linux `basic_text` it is never written silently: a warning and a passphrase come first; storing it unprotected is a second, explicit choice.
- **Migrations**: versioned `.sql` files, `PRAGMA user_version`, a small migrator, zod-parsed rows behind storage ports. No Drizzle in v1: triggers and pragmas are raw SQL.
- **Indexes** for every list and filter query; per-sender statistics update in the upsert transaction. **Packaging**: `.node` files are `asarUnpack`ed; only the target platform's prebuilds ship, both macOS ones in the universal build.
- **Account removal** deletes every account-scoped row (outbox events and jobs too) and anonymises its action-log entries; a test pins the tables. Free-text columns are length-capped.
- **Data location** comes from the `Platform` port ("Show in Finder", "Delete all local data"). Saved files are never deleted ([ADR 0010](0010-saved-attachments-go-to-user-storage.md)).
- **Backups**: none in v1; "Export my data" writes settings and history as JSON. The packaging smoke test opens the packaged database on three OSes: wrong key rejected, header not plaintext.
- **Prompt IPC**: the prompt runs before the worker exists, so main serves four zod-validated `storage:*` calls, answering status words only and refusing other frames.
- **Status**: `ready` (nothing to ask), `choose` (`basic_text`, no choice yet), `locked` (passphrase set, not entered), `blocked` (the key cannot be produced: a database exists without any choice, or the choice or key file is damaged). The app shows `BlockedStep` and never asks for a new passphrase, so it cannot overwrite unopenable data.
- **Passphrase**: 12 to 256 characters (main-process schema), NFKC-normalised. scrypt N=2^17, r=8, p=1, random 16-byte salt; 64 output bytes: the first 32 are the database key, the last 32 a verifier. A stored `N` outside 2^15 to 2^20 (powers of two), or `r` and `p` other than 8 and 1, is refused.

## Consequences
The database holds reports and the action log, not mail ([0014](0014-store-reports-and-actions-not-mail.md)). Windows, Linux arm64 and Linux libsecret are not covered by CI yet.

## Alternatives considered
`node:sqlite` (no encryption) · libsql (less proven in Electron) · renderer IndexedDB (wrong process, no encryption).
