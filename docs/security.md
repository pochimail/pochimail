# Security

Pochimail handles a whole mailbox. Local only: no Pochimail server, no telemetry. Report vulnerabilities privately ([SECURITY.md](../SECURITY.md)). Reasons live in ADRs [0002](adr/0002-electron-process-model-and-ipc.md), [0005](adr/0005-local-storage.md), [0007](adr/0007-oauth-credentials-scopes.md), [0008](adr/0008-notifications-and-privacy.md), [0012](adr/0012-delete-moves-to-trash-with-approval.md), [0013](adr/0013-unsubscribe-suggested-user-decides.md), [0014](adr/0014-store-reports-and-actions-not-mail.md).

## Rules
- **Storage**: the database is encrypted. Its key and OAuth refresh tokens live only in the OS keychain (`safeStorage`), never in files or logs. On Linux `basic_text` the key comes from a passphrase (scrypt, never stored) unless the user explicitly chooses to store without protection. Access tokens stay in memory. Client ids come from env or config, never hard-coded.
- **Scopes**: least privilege, requested incrementally. Never a delete scope and never `https://mail.google.com/`.
- **Electron**: `contextIsolation`, sandbox, no `nodeIntegration`, a narrow preload through `contextBridge`, strict CSP, navigation and new-window blocking, `webSecurity` on, Fuses set, a supported Electron major.
- **Email is hostile**: never execute or render remote content, block remote images, never follow links in bodies. Unsubscribe only through RFC 8058 one-click or `mailto:`. Attachments are hashed and written only when the user saves them, never opened automatically. Never persist bodies, subjects, snippets or addresses ([ADR 0014](adr/0014-store-reports-and-actions-not-mail.md)).
- **The model never acts**: it classifies and explains, with schema-constrained output validated by zod. Actions come from policies and user approval.
- **Supply chain**: pinned lockfile, few dependencies (ask before a heavy one), `osv-scanner` in CI, an SBOM per release. pnpm's `minimumReleaseAge` stays on; add no exclusion without an ADR note.
- **Releases**: a SHA-256 checksum file with every release and SHA-256 checks on model files. v1 builds are not code-signed; signing is prepared and switches on when the signing secrets exist ([release.md](release.md)). The update notice reads a version file from GitHub Releases and opens the download page: nothing installs itself. An external security review before 1.0.
- **Logs** redact names, addresses, subjects, attachment names and tokens. No crash reporting in v1.

## Assets and trust boundaries
| Asset | Protection |
|---|---|
| Mail data and reports | Encrypted SQLite owned by the worker; only ids, dates, hashes and reports ([ADR 0014](adr/0014-store-reports-and-actions-not-mail.md)) |
| Tokens, database key | OS keychain; Linux `basic_text` is refused unless the user chooses to continue |
| Mailbox integrity | The promise is in [product.md](product.md). Every action is logged with its inverse |
| Saved documents | The user's own folder, kept when an account is removed |
| Models | SHA-256 pinned in a signed manifest |
| App and updates | SHA-256 checksums on GitHub Releases; the update notice only opens the download page; code signing follows |

Boundaries: main holds no mail and hands a `MessagePort` to renderer and worker, which talk directly. The renderer is treated as compromisable by email content, so the worker validates every message with zod. The model host has no network and no database. Secrets cross only the `SecretStore` port. OAuth runs in the system browser with PKCE, a `state` check and a loopback listener that closes after one request.

## Threats and mitigations
| Threat | Mitigation |
|---|---|
| Email HTML or script runs in the renderer | Sandbox, CSP, no Node, blocked navigation, permissions denied |
| Crafted RPC from a compromised renderer | zod on both sides, one authorize function, no generic `ipcRenderer` |
| Prompt injection steers the model | The model has no tools; policies and approval decide |
| Malicious attachment or parser exploit | Never auto-opened, size and time limits, minimal parsers |
| Hostile sender trains Pochi to trust it | Learning only from the user's corrections; Autopilot never deletes |
| Wrong batch deletes or archives mail | Preview, user approval, Trash only, undo across restarts, protection signals ([ADR 0012](adr/0012-delete-moves-to-trash-with-approval.md)) |
| Database copied from disk | Encryption, key in the keychain |
| Token or content in logs | Redaction, tokens only in the keychain |
| Unlisted host contacted | Allow-list in the session filter and the worker client, exact hosts, no wildcard |
| Token theft on the loopback port | PKCE, `state`, random port on `127.0.0.1`, one request |
| Phishing app or fork using our client id | Ids from config, verified publisher status |
| Compromised dependency, release or model | Pinned versions, release-age gate, release checksums (signing once enabled), model hashes |
| Tampered models | Manifest signature and SHA-256 before use |

Accepted risks: a same-user process can write the database file, and decrypted memory can reach swap. Out of scope: a compromised OS account, an unlocked stolen machine, a compromised provider.

## Network allow-list
Enforced by `session.webRequest` in every session and by the worker HTTP client, from one shared registry. No wildcard, no plaintext HTTP, blocked requests log the host only. Adding a host means updating this table and asking the maintainer.

| Host | Why |
|---|---|
| `gmail.googleapis.com` | Gmail API |
| `oauth2.googleapis.com` | Google token exchange, refresh, revoke |
| `graph.microsoft.com` | Microsoft Graph mail (v1.1; unreleased) |
| `login.microsoftonline.com` | Microsoft token calls (v1.1; no public revocation endpoint) |
| `github.com`, `release-assets.githubusercontent.com` | Update notice only: a plain GET of `latest.json` from the latest GitHub Release, and the host it redirects to. No headers or identifiers; a redirect to any other host is refused |
| `huggingface.co`, `us.aws.cdn.hf.co`, `us.gcp.cdn.hf.co`, `cdn-lfs-us-1.hf.co`, `cdn-lfs-eu-1.hf.co`, `transfer.xethub.hf.co`, `transfer.xethub-eu.hf.co` | Model downloads: the pinned file URL and the CDN hosts it redirects to |

Sign-in pages load in the user's browser, so they are not listed. The loopback redirect and IPC ports are local. Not used: telemetry, crash reporting, a relay, cloud AI, remote images or fonts, link following, MX or autoconfig lookups.

**One exception: one-click unsubscribe.** One dedicated worker path may POST `List-Unsubscribe=One-Click` to the exact `https` URL of a message's `List-Unsubscribe` header, only when the message has `List-Unsubscribe-Post`, and only after the user confirmed, or under Autopilot's rule in [ADR 0013](adr/0013-unsubscribe-suggested-user-decides.md). No cookies, no redirects followed, no `Referer`, no IP literal or private, loopback or `localhost` address, short timeout, response discarded, every call logged without the URL. The sender learns the address is active; the UI says so. Tests must refuse `http`, redirects, private addresses and URLs that differ from the header.

## Open points
Whether the model host can be denied network access at the OS level on all three systems; which libraries parse attachments and PDFs; Google's answer on CASA for a local-only app ([ADR 0007](adr/0007-oauth-credentials-scopes.md)).
