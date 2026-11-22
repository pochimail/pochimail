# 0012 — Delete moves email to the Trash, only with the user's approval

Status: Accepted (2026-11-19) · Changes the "never delete" invariant · Related: [ADR 0007](0007-oauth-credentials-scopes.md)

## Context
Archiving keeps an inbox tidy but frees no mailbox space. Users want what a disk cleaner does for files: remove what is useless, safely. The original invariant ("nothing is ever deleted") made that impossible.

## Decision
- Pochimail can delete email. **Delete always means moving to the provider's Trash**: Gmail `users.messages.trash` (covered by `gmail.modify`), Microsoft Graph move to Deleted Items (covered by `Mail.ReadWrite`). No new scope.
- Pochimail never deletes permanently and never empties the Trash. It never requests Gmail's full-access scope (`https://mail.google.com/`).
- **Every deletion is approved by the user** in a Review list (preview, checkboxes, one confirm). Autopilot never deletes in v1.
- **Protection comes from what is detected, not from category names.** An email is never pre-selected for deletion when any of these signals is true; the user may still select it manually:
  - it was written by a real person (not automated), or the user ever wrote to or replied to that sender;
  - it is starred, flagged or marked important by the provider;
  - it belongs to a recent conversation or carries a "Needs a reply" or "Time-sensitive" signal (dates and deadlines);
  - it has an attachment the user has not saved;
  - the sender is marked Keep.
  Signals are computed per email by the local classifier ([ADR 0016](0016-fixed-types-and-automatic-topics.md)); when the classifier is unsure, the email is protected.
- Every deletion is logged with its inverse; **Undo restores from the Trash** while the provider still holds the message.
- Clean up reports space you can free by deleting separately from email you can archive. Sizes come from the provider (Gmail `sizeEstimate`; the Graph size source must be verified before a figure is shown for Microsoft accounts).
- The user-facing promise becomes: "You keep the control. Nothing is deleted without your approval. Deleted emails go to the Trash, and you can undo."

## Consequences
- "GB you can free" is a real figure again, tied to deletion only.
- Copy, invariants, tests and designs that say "never deleted" must change.
- Undo is time-limited by the provider's Trash retention; the UI says so.

## Alternatives considered
- Archive only: rejected; frees no space.
- Permanent deletion: rejected; irreversible and needs the full-access Gmail scope.
