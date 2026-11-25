# 0012 — Delete moves email to the Trash, only with the user's approval

Status: Accepted (2026-11-19) · Changes "never delete" · Related: [ADR 0007](0007-oauth-credentials-scopes.md)

## Context
Archiving frees no space. Users want a disk cleaner's result, safely. "Nothing is ever deleted" made that impossible.

## Decision
- Pochimail can delete email. **Delete always means moving to the provider's Trash**: Gmail `users.messages.trash` (`gmail.modify`), Microsoft Graph move to Deleted Items (`Mail.ReadWrite`). No new scope.
- Never permanent deletion, never emptying the Trash, never Gmail's full-access scope (`https://mail.google.com/`).
- **Every deletion is approved by the user** in a Review list (preview, checkboxes, one confirm). Autopilot never deletes.
- **Protection comes from detected signals, not category names.** An email is never pre-selected for deletion when any is true; the user may still select it manually:
  - written by a real person, or the user ever replied to that sender;
  - starred, flagged or marked important by the provider;
  - in a recent conversation, or carrying a "Needs a reply" or "Time-sensitive" signal;
  - has an attachment the user has not saved;
  - the sender is marked Keep.
  Signals are computed per email by the local classifier ([ADR 0016](0016-fixed-types-and-automatic-topics.md)); when it is unsure, the email is protected.
- Every deletion is logged with its inverse; **Undo restores from the Trash** while the provider holds it.
- Clean up reports freeable space apart from archivable email, using provider sizes (Gmail `sizeEstimate`; verify Graph before showing Microsoft figures).
- Promise: "You keep the control. Nothing is deleted without your approval. Deleted emails go to the Trash, and you can undo."

## Addendum (#128): unsure
- Unsure: confidence below `UNSURE_BELOW` (0.6), no recorded decision, or an unknown fact (attachment count, sender, date). It protects unconditionally: never pre-selected, proposed or auto-applied. Its signal has confidence `UNSURE_CONFIDENCE` (0.5), reason "Not sure, kept safe", and is never counted.
- "Time-sensitive" is a proxy: a recent unopened `records` email. Stored text is off limits (ADR 0014), so deadlines are unread: it misses dated mail of other types and flags undated records.

## Consequences
- "GB you can free" is real again, tied to deletion only.
- Copy, invariants, tests and designs saying "never deleted" change.
- Undo is limited by the provider's Trash retention; the UI says so.

## Alternatives considered
- Archive only: rejected; frees no space.
- Permanent deletion: rejected; irreversible, needs full-access scope.
