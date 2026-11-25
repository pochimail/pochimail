# 0005 — Local storage and encryption at rest

Status: Accepted (2026-11-17) · Amended by [0014](0014-store-reports-and-actions-not-mail.md) (what is stored; no FTS); blob store amended by [0010](0010-saved-attachments-go-to-user-storage.md)

## Decision
- **SQLite with SQLCipher-compatible encryption** through `better-sqlite3-multiple-ciphers`, pinned `13.1.1`. It ships Node-API prebuilds, so nothing is rebuilt for Electron. WAL mode, `foreign_keys=ON`, one writer (the worker).
- **Key**: a random 256-bit key generated at first launch and stored with Electron `safeStorage` (Keychain, DPAPI, libsecret), using the async calls. Never written silently on Linux's `basic_text` backend: show a plain warning and offer a passphrase first; "store without protection" is only a second, explicit choice.
- **Migrations**: hand-written versioned `.sql` files, `PRAGMA user_version`, a small migrator, and zod-parsed rows behind the storage ports. No Drizzle in v1: it needs a driver alias, is heavy, and the parts that matter (triggers, pragmas) are raw SQL anyway. Revisit if the schema outgrows hand-written queries.
- **Indexes** for every list and filter query; per-sender statistics maintained incrementally in the same transaction as the upsert.
- **Packaging**: the `.node` files are `asarUnpack`ed and only the target platform's prebuilds ship; both macOS prebuilds stay in the universal build.
- **Account removal** deletes every row scoped to the account (including pending outbox events and jobs); its action-log entries are anonymised in place. A test pins the list of account-scoped tables. Free-text columns have length caps.
- **Data location** comes from the `Platform` port; "Show in Finder" and "Delete all local data" operate on it. Saved files in the user's storage are never deleted ([ADR 0010](0010-saved-attachments-go-to-user-storage.md)).
- **Backups**: none in v1. "Export my data" writes settings and history as JSON.
- The packaging smoke test opens the encrypted database inside the packaged app on three OSes and checks wrong-key rejection and a non-plaintext header.

- **Prompt IPC**: the passphrase prompt runs before the worker exists, so it cannot use the worker contract. Main serves four calls (`storage:*`), zod-validated, answering status words only, refused from any frame that is not the app page. One text field component (`TextField`, design PR #162) serves the prompt.

## Consequences
The database is a cache of the mailbox plus the action log. Windows and Linux arm64 and the Linux libsecret path are not covered by CI yet.

## Alternatives considered
`node:sqlite` (no encryption) · libsql (less proven in Electron) · IndexedDB in the renderer (wrong process, no encryption).
