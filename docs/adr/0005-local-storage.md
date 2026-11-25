# 0005 — Local storage and encryption at rest

Status: Accepted (2026-11-17) · Amended by [0014](0014-store-reports-and-actions-not-mail.md) (what is stored); blob store by [0010](0010-saved-attachments-go-to-user-storage.md)

## Decision
- **SQLite with SQLCipher-compatible encryption** through `better-sqlite3-multiple-ciphers`, pinned `13.1.1`. WAL mode, `foreign_keys=ON`, one writer (the worker).
- **Key**: a random 256-bit key generated at first launch, stored with Electron `safeStorage` (Keychain, DPAPI, libsecret), async calls only. On Linux `basic_text` it is never written silently: a warning and a passphrase come first; "store without protection" is a second, explicit choice.
- **Migrations**: versioned `.sql` files, `PRAGMA user_version`, a small migrator, zod-parsed rows behind the storage ports. No Drizzle in v1: triggers and pragmas are raw SQL anyway.
- **Indexes** for every list and filter query; per-sender statistics update in the upsert transaction. **Packaging**: `.node` files are `asarUnpack`ed; only the target platform's prebuilds ship.
- **Account removal** deletes every account-scoped row (outbox events and jobs too) and anonymises its action-log entries; a test pins the table list. Free-text columns have length caps.
- **Data location** comes from the `Platform` port, which "Show in Finder" and "Delete all local data" use. Saved files are never deleted ([ADR 0010](0010-saved-attachments-go-to-user-storage.md)).
- **Backups**: none in v1; "Export my data" writes settings and history as JSON. The packaging smoke test opens the database in the packaged app on three OSes: wrong key rejected, header not plaintext.
- **Prompt IPC**: the prompt runs before the worker exists, so main serves four zod-validated `storage:*` calls, answering status words only, refused from any other frame.
- **Status**: `ready` (nothing to ask), `choose` (`basic_text`, no choice yet), `locked` (passphrase set, not entered), `blocked` (the key cannot be produced: a database exists without any choice, or the choice or key file is damaged). The app shows `BlockedStep` and never asks for a new passphrase, so it cannot overwrite data it cannot open.
- **Passphrase**: 12 to 256 characters (main-process schema), NFKC-normalised. scrypt with N=2^17, r=8, p=1 and a random 16-byte salt; one run yields 64 bytes: the first 32 are the database key, the last 32 only a verifier. A stored `N` must be a power of two from 2^15 to 2^20, `r` and `p` 8 and 1, else it is refused.

## Consequences
Windows, Linux arm64 and Linux libsecret are not covered by CI yet.

## Alternatives considered
`node:sqlite` (no encryption) · libsql (less proven in Electron) · IndexedDB in the renderer (wrong process, no encryption).
