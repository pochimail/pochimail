# Product

Pochimail is a private assistant that gives you the big picture of your email accounts, flags what needs you, clears clutter and saves your documents. Everything runs on your computer. Pochi (from *pochi-bukuro* ポチ袋, the small Japanese gift envelope) is the assistant; the site is getpochimail.com.

## What it is, and is not
- **Is**: an overview and cleanup assistant for one or several Gmail accounts. Outlook / Microsoft 365 and other providers (IMAP) come in v1.1 ([ADR 0011](adr/0011-v1-providers-google-and-microsoft.md)).
- **Is not**: a mail client. Nobody reads or writes email in Pochimail; a single email opens in the user's mail app.
- **Users**: non-technical people with years of email across accounts who want to stop missing what matters, free space, find documents and trust that nothing is lost.

## Jobs (chosen at setup, any combination)
1. **Catch what matters**: people waiting on you, threads waiting on others, deadlines, important senders.
2. **Declutter**: unsubscribe, archive old alert emails, delete what is useless.
3. **Organize**: topics applied as real provider labels; types drive actions ([ADR 0016](adr/0016-fixed-types-and-automatic-topics.md)).
4. **Save documents**: invoices, contracts, IDs, payslips, saved to a folder the user chooses ([ADR 0010](adr/0010-saved-attachments-go-to-user-storage.md)).

## Autonomy (one choice)
- **Just look**: read-only.
- **Suggest** (default): prepares; the user approves each step.
- **Autopilot**: only high-confidence, low-risk actions, then a summary with undo. Never deletes, never acts on People.

## Invariants in every mode
- You keep the control: nothing is deleted without your approval. Deleted emails go to the Trash, and you can undo.
- Email from real people is never selected for cleanup without approval ([ADR 0012](adr/0012-delete-moves-to-trash-with-approval.md)).
- Every batch is previewed, every action is logged and undoable. Unsubscribe is the exception and the UI says so first ([ADR 0013](adr/0013-unsubscribe-suggested-user-decides.md)).

## Mail model
- **Types, signals and topics** ([ADR 0016](adr/0016-fixed-types-and-automatic-topics.md)): every email has one of five types (personal, transactional, notification (shown as Alert emails), newsletter, promotion), per-email signals that drive protection, and topics discovered from the user's own mailbox. *Suspicious* is a flag. Only types and topics that contain email are shown. The seven categories still in the code are replaced by #100.
- **Topics** (any number, user-editable): Job search, Work, Finance, Home, Health, Travel, Family, Projects…
- **Signals** (computed): needs a reply, waiting on them, important sender, has a document, time-sensitive, old and never opened.
- Classification is local, cheapest first: rules, then calibrated decision heads, then a small local LLM ([ADR 0006](adr/0006-local-ai-runtimes-and-models.md)). It learns from the user's corrections, on the device.

## Principles
1. Local first: no server, no cloud AI, no telemetry in v1.
2. The assistant proposes, the user decides.
3. Safe by default: preview, protect people, log, undo.
4. Never block the user: background work with live progress, usable while sorting, usable offline with the last synced data.
5. Privacy is the first message wherever data is processed.

## Flow
Welcome → Connect (Google) → Set up (two questions: what to help with, how much to do) → Overview while sorting → a Summary sheet when the first scan ends → the everyday loop: notification or menu bar → Overview → Review → act → Undo. Other screens: Documents, Activity and undo, Settings, Autopilot summary, menu-bar popover. Keep it tidy runs the same loop on a cadence: as it arrives, daily, weekly or only when asked.

## Scope
- **v1**: macOS first, then Windows and Linux; light and dark; keyboard shortcuts; WCAG AA; multiple accounts with a unified view and per-account filters.
- **Out of v1**: reading or composing mail, permanent deletion, mobile, any cloud AI, Teams, IMAP providers.
- **v1.x**: IMAP accounts (v1.1), an optional notification relay, rclone export, custom rules.
- **v2**: natural-language search, a mobile companion, encrypted device sync through the user's own drive.
- **Teams** (later): shared workspaces and handover when someone leaves. v1 shows a disabled "Teams · Soon" item and keeps `workspaceId` on every entity.

## Voice
Pochi speaks in the first person, briefly and warmly: "Here's what I found", "I haven't changed anything yet". Plain language, no jargon. Rules for wording are in [design.md](design.md).
