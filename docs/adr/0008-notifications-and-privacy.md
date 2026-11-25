# 0008 — Notifications and privacy

Status: Accepted (2026-11-17)

## Decision
- A **Notifier** port with a desktop adapter (Electron `Notification`) and an in-app notification center.
- **Kinds**: sorting finished, digest ready, Autopilot report, account needs reconnecting, update ready.
- **Counts only** by default ("3 people are waiting on you, 1 deadline Friday"); names and subjects only when "Show names and subjects" is on.
- **Coalescing**: one notification per kind per 15-minute window; digests replace earlier undelivered ones; a daily cap.
- **Quiet hours** (default 22:00–08:00 local time): no OS notification is shown. Until there is a setting for it, a notification that arrives then is dropped, not held.
- Clicking a notification opens the matching sheet or screen.
- **No telemetry and no crash reporting in v1.** Logs are local, structured, redacted (no addresses, subjects, bodies or attachment names) and rotated. "Export diagnostics" produces a redacted bundle.
- **Network allow-list**, enforced with `session.webRequest` in every session and in the worker's HTTP client: Google APIs (Microsoft from v1.1), GitHub Releases, exactly `huggingface.co` and `us.aws.cdn.hf.co` for models, and the single one-click unsubscribe path ([ADR 0013](0013-unsubscribe-suggested-user-decides.md)). Every host is documented in [docs/security.md](../security.md).
- A remote push relay stays v1.x, off by default.

## Alternatives considered
Crash reporting (needs an outbound host; deferred to v1.x).
