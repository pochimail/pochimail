# 0017 — Electron end-to-end and visual tests

Status: Accepted (2026-11-25)

## Context
Unit tests cannot show that onboarding runs in a real window, or that a token change moved a pixel. The app must be tried as a user meets it, without a real account or the network.

## Decision
- **Tool**: `@playwright/test`, pinned, driving Electron. Electron is the browser, so no Playwright browsers are downloaded. Playwright respects pnpm's `minimumReleaseAge`.
- **Target**: `pnpm --filter @pochimail/desktop e2e` builds the app with `POCHIMAIL_E2E=1` into `out-e2e/` (dev gallery on; never packaged) and starts it on the fixture-backed worker (`POCHIMAIL_DEMO`, plus `POCHIMAIL_DEMO_FIRST_RUN` and `POCHIMAIL_DEMO_SCAN_PACE_MS`, honoured only in unpackaged builds).
- **Hardening**: the harness passes no window or web preference; the renderer keeps no Node, and a test proves it (ADR 0002). `--no-sandbox` is passed on Linux only, as in the packaging smoke.
- **Waits** are on events (window shown, text appears, scan ends). A flaky test is fixed, never retried or given a longer pause.
- **Smoke** (Welcome, Connect, Setup, Overview while sorting, Summary, pause and resume) runs on all three CI OSes. It fails on a renderer `pageerror` or a `renderer-error` console line from the error boundary.
- **Picture tests** (every screen and every still gallery state, light and dark) run on **Linux only**. The same bundled fonts rasterise differently per OS (measured: macOS differs from Linux by 1 to 4 % of the pixels of a screen), so one OS owns the baselines. Motion moments are timer-driven and are rendered, not compared.
- **Tolerance**: per-pixel colour distance 0.1, and no other differing pixel. A one-pixel change of a size token must fail; raise this only with a measured cause.
- **Welcome vs reference**: the light reference is an HTML page, so geometry and type are measured in both and compared (2px). Known differences are pinned and may only shrink.
- **Baselines** live in `apps/desktop/e2e/__screenshots__`. To change one, delete the PNG and push: CI uploads the new image as the `e2e-screenshots` artifact; commit it.

## Consequences
macOS and Windows are not checked pixel by pixel; their fonts may differ. CI gains one job per OS.

## Alternatives considered
- Baselines per OS: three times the images and three times the review, for the same design.
- Pixel-diffing the Welcome PNG: the reference is a design export with placeholder mascot art and its own window chrome.
