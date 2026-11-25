# 0002 — Electron process model and IPC streaming

Status: Accepted (2026-11-17)

## Context
The UI must stay instant while a 100k-message sync and model inference run. Mail data must never reach a context that email content could compromise.

## Decision
- **main**: windows, lifecycle, tray or menu bar, login item, notifications, OS calls, update checks, the session network filter. It holds no mail data.
- **worker**: one `utilityProcess` running the composition root (domains, workflows, adapters, job workers). It owns the database.
- **model host**: a second `utilityProcess` for `node-llama-cpp` and embeddings, so a model crash never takes the worker down. Main supervises it (ping, restart with back-off, a new private port per restart); the worker re-sends in-flight requests.
- **renderer**: React 19 SPA (electron-vite, TanStack, React Compiler). No Node access.
- **Transport**: main creates a `MessageChannelMain` and gives one port to the worker and one to the renderer through the preload. Renderer and worker traffic bypasses main.
- **Preload**: exposes `requestWorkerPort` and a few OS calls (`openMailAppLink` for `mailto:` and `message:` only, `showInFinder`, `chooseFolder`), `onOpenScreen` (a notification click), each validated; main refuses senders that are not the app page. Nothing mail-related goes through main.
- **Protocol**: an in-house typed RPC and subscription layer over the port, with zod schemas shared by both sides in `apps/desktop/src/shared/ipc/`.
- **Streaming**: the worker flushes batched events every 50 ms (max batch 500), with at most 2 unacknowledged batches; latest-state events (progress) are coalesced per key. Nothing is dropped.
- **Renderer data**: TanStack Query caches updated from events, no polling; optimistic mutations are reconciled on `ActionApplied` or `ActionFailed`.
- **Untrusted HTML**, if ever shown, only in a sandboxed iframe with its own CSP, no remote images and no preload.
- **Hardening**: contextIsolation, sandbox, no nodeIntegration, `webSecurity`, strict CSP without `unsafe-inline`, navigation and `window.open` blocked, permissions denied by default, Fuses (RunAsNode off, cookie encryption on, ASAR integrity on, only-load-from-asar) applied at packaging, Electron on a supported major. A checklist test enforces it.

## Consequences
Every message is schema-validated on both sides. Main can restart the worker without losing state, because jobs are persistent ([ADR 0003](0003-hexagonal-core-events-outbox.md)).

## Alternatives considered
- `electron-trpc` and forks: built on `ipcMain`, so every message passes through main; no maintained adapter targets MessagePort between a renderer and a `utilityProcess`; adds a supply-chain dependency.
- Everything in main: blocks the UI, larger attack surface.
- `worker_threads` only: no isolation from native crashes.
