## Ticket
Closes #…

## Why
<!-- One or two sentences: the problem this PR solves, in product or engineering terms. -->

## Every new file, and why it exists
<!-- One line per new file: path — the single responsibility it owns — why no existing file could own it. "None" is a fine answer. -->

## What this deletes
<!-- Code, files, options or dependencies removed. A PR that only adds should say why nothing could go. -->

## Design check (UI PRs)
<!-- Screenshot pair: reference (docs/design/screens/…) vs implementation, same viewport. List any accepted difference. -->

## Verification
<!-- Each acceptance criterion → the command or test that proves it, and its result. -->

## Checklist
- [ ] UI PRs: e2e baselines regenerated (delete PNG, push, commit from `e2e-screenshots` artifact).
- [ ] `pnpm check` is green locally (typecheck, lint, knip, test, arch, quality, manypkg).
- [ ] No new dependency, or it is justified here and approved.
- [ ] No new package, folder convention, pattern or abstraction, or it has an ADR.
- [ ] No speculative code: every option, prop, parameter and branch is used by this ticket.
