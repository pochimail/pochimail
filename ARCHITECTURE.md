# Architecture

## Overview
Pochimail is an Electron app. It connects to Gmail with OAuth (Outlook comes in v1.1), syncs message headers incrementally, classifies email with local models, and proposes actions (archive, delete to Trash, unsubscribe, label, save attachments) that the user reviews. Every action is logged with its inverse. The database stores what Pochimail found and did, never what emails say ([ADR 0014](docs/adr/0014-store-reports-and-actions-not-mail.md)).

## Packages ([ADR 0015](docs/adr/0015-bounded-context-packages-and-quality-gates.md))
Every workspace is `packages/<name>` or `apps/<name>`. Packages are of three kinds.

| Domain | Owns |
|---|---|
| `accounts` | connected mailboxes and their lifecycle |
| `mailbox` | incremental sync into the minimal message record |
| `classification` | type, signals and topics per email |
| `cleanup` | recommendations, protection, scan reports |
| `actions` | apply, log and undo; unsubscribe; Autopilot |
| `documents` | saving attachments to the user's storage |

| Adapter | Implements |
|---|---|
| `db` | every repository port, in one encrypted SQLite file |
| `net` | allow-listed HTTP and OAuth sign-in |
| `gmail`, `graph` | provider ports for accounts, mailbox, actions, documents |
| `ai` | classification ports with local models |

| Shared | Role |
|---|---|
| `kernel` | Result, ids, errors, clock, event envelope |
| `workflows` | the only place domains meet: events → commands |
| `pipeline` | event bus, jobs, outbox, scheduling |
| `logger`, `ui`, `testing` | logging with redaction; design system; fixture mailbox and eval |

**Imports:** domains → `kernel` and `zod`. `workflows` → domains and `pipeline` (it assembles the scan as jobs; `pipeline` never imports a domain). Adapters → the domains whose ports they implement, plus `kernel`, `logger`, and `net` for `gmail` and `graph`; `db` also implements the `pipeline` job-queue and outbox ports and `net` reuses its retry backoff; `testing` hosts the `net` contract suites. Apps compose all. Enforced by `.dependency-cruiser.cjs`.

## Processes
| Process | Does |
|---|---|
| renderer | React UI, sandboxed; talks to the worker through `apps/desktop/src/shared` |
| preload | typed methods: `requestWorkerPort`, `openMailAppLink`, `showInFinder`, `chooseFolder`, `onOpenScreen` |
| main | windows, OS, keychain, supervision; tells the worker the power state and shows its notifications (one-way messages) |
| worker | runs domains, workflows, pipeline and adapters |
| model host | local inference |

## A scan
1. **accounts**: OAuth PKCE sign-in; tokens in the keychain.
2. **mailbox**: Gmail history or Graph delta → message records → `messages synced`.
3. **classification**: type, signals, topics → `messages classified`.
4. **cleanup**: recommendations; protected email never pre-selected → `recommendations ready`.
5. **actions**: the user approves; log as pending, apply through the provider, mark applied with its inverse.
6. **workflows** chain each step; **pipeline** runs them as jobs with batching, retries and an outbox.

## Start reading
- Use case: `packages/accounts/src/use-cases/connect-account.ts`
- A port and its contract suite: `packages/accounts/src/ports/secret-store.ts` and `packages/accounts/src/testing/secret-store-contract.ts`
- The scan flow: `packages/workflows/src/use-cases/run-scan.ts` and `packages/workflows/src/jobs/scan-pipeline.ts`
- IPC: `apps/desktop/src/shared/ipc/`
- Boundaries: `.dependency-cruiser.cjs`

## Releases
`electron-updater` reads GitHub Releases: signed and notarized builds, stable and beta channels, differential downloads. Models update separately through a signed manifest with SHA-256 per file ([ADR 0006](docs/adr/0006-local-ai-runtimes-and-models.md)). The repository owner and name live only in the root `package.json` `repository` field; the updater and About screen read it. Security rules: [docs/security.md](docs/security.md).
