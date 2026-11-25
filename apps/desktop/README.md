# @pochimail/desktop

## Why this package exists
The shipped Electron app and its composition root (ADR 0002).

## Owns
- `main/`, `preload/`, `worker/`, `model-host/`, `renderer/`: one folder per process (see ARCHITECTURE.md).
- `shared/`: the IPC contract used by every process.
- `build/`, `resources/`, `packaging/`: icons (per platform), tray assets, electron-builder config.
- `e2e/`: Playwright smoke and picture tests on the fixture worker (ADR 0017).

## May import
All workspaces, only in the process that needs them: the worker composes domains, workflows, pipeline and adapters; the renderer uses `ui` and `shared/` only.

## Must not contain
- Domain logic (it belongs in a domain) or presentational components (they belong in ui).
- Imports between feature folders, or from the renderer into main/worker/model-host.
- Fixture code reachable from a production build.
