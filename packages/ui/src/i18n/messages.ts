import { connectMessages } from "./connect-messages.ts";
import { notificationMessages } from "./notification-messages.ts";
import { reviewMessages } from "./review-messages.ts";
import { settingsMessages } from "./settings-messages.ts";
import { sizeMessages } from "./size-messages.ts";
import { storageMessages } from "./storage-messages.ts";
import { summaryMessages } from "./summary-messages.ts";

/** English is the fallback; French and Japanese ship in v1 (P13, 2026-11-19). */
export const USER_LOCALES = ["en", "fr", "ja"] as const;

export type UserLocale = (typeof USER_LOCALES)[number];
/** `pseudo` is a dev-only layout probe: never user-selectable, never shipped as a choice. */
export type Locale = UserLocale | "pseudo";

export type MessageEntry = { readonly text: string; readonly params: readonly string[] };

/** Catalog authoring helper: the tuple keeps `{placeholders}` typed (code: `{name, plural, ...}`). */
export const entry = <const Params extends readonly string[]>(text: string, params: Params) => ({
  text,
  params,
});

/**
 * ICU-style patterns: `{name}`, `{name, number}`, `{name, date, long}` and
 * `{name, plural, =0 {...} one {...} other {...}}`.
 * Voice: "email"/"emails", "Pochi"/"I", functional titles, `{device}` for the host.
 */
export const messages = {
  "action.close": entry("Close", []),
  "action.undo": entry("Undo", []),
  "action.backToOverview": entry("Back to overview", []),
  "overview.title": entry("Overview", []),
  "overview.privacy": entry("Everything stays on this device. Nothing is sent anywhere.", []),
  "overview.promise.device": entry("Your email never leaves this {device}.", ["device"]),
  "overview.sorting": entry("Sorting privately on this {device}", ["device"]),
  "overview.email.count": entry("{count, plural, =0 {No emails} one {# email} other {# emails}}", [
    "count",
  ]),
  /** One size per figure (#114): each rounded value picks its own unit, never a raw byte count. */
  ...sizeMessages.en,
  /** Cumulative Overview actions (#114); the Summary's figures are proposals, not these. */
  "overview.figure.archived": entry("emails archived", []),
  "overview.figure.saved": entry("attachments saved", []),
  "overview.figure.unsubscribed": entry("newsletters unsubscribed", []),
  "scan.failed": entry(
    "I could not finish sorting. Nothing was changed. Start again and I will continue where I stopped.",
    [],
  ),
  "overview.review": entry("Review", []),
  "review.counts.title": entry("What I found", []),
  "review.counts.toReview": entry("To review", []),
  "review.counts.waiting": entry("Waiting on you", []),
  "review.counts.deadlines": entry("With deadlines", []),
  "review.counts.important": entry("From important people", []),
  "review.cleanable.title": entry("Safe to clean up", []),
  ...reviewMessages.en,
  "review.loading": entry("Loading your review", []),
  "review.error.title": entry("I could not load your review.", []),
  "overview.pause": entry("Pause", []),
  "overview.resume": entry("Resume", []),
  "overview.viewSummary": entry("View summary", []),
  "overview.catch.title": entry("Catch what matters", []),
  "overview.clean.title": entry("Clean up", []),
  "overview.accounts": entry("{count, plural, one {# account} other {# accounts}}", ["count"]),
  "overview.catch.note": entry("I never clean these", []),
  "overview.clean.note": entry("Nothing happens until you review it", []),
  "overview.waiting.title": entry(
    "{count, plural, one {person is waiting on you} other {people are waiting on you}}",
    ["count"],
  ),
  "overview.waiting.detail": entry(
    "The oldest has waited {days, plural, one {# day} other {# days}}",
    ["days"],
  ),
  "overview.deadlines.title": entry(
    "{count, plural, one {email mentions a deadline} other {emails mention a deadline}}",
    ["count"],
  ),
  "overview.deadlines.detail": entry("Dates I found in your emails", []),
  "overview.important.title": entry(
    "{count, plural, one {email from an important person} other {emails from important people}}",
    ["count"],
  ),
  "overview.important.detail": entry("Senders you often reply to", []),
  "overview.clean.headline": entry("emails you can delete, out of {total, number}", ["total"]),
  "overview.clean.summary": entry("{total, number} emails sorted", ["total"]),
  "overview.clean.keep": entry("Stays", []),
  "overview.clean.free": entry("Can be deleted", []),
  "overview.clean.sizeUnknown": entry("I have counts, not sizes, so I can’t show GB freed.", []),
  "overview.clean.noFreeing": entry("These don’t free space", []),
  "overview.clean.never": entry("Emails that look important are never selected for you.", []),
  "overview.rec.newsletters.sentence": entry("Unsubscribe from newsletters", []),
  "overview.rec.newsletters.reason": entry("Regular senders you can leave", []),
  "overview.rec.promotions.sentence": entry("Delete old promotions", []),
  "overview.rec.promotions.reason": entry("Sales and marketing emails", []),
  "overview.rec.notifications.sentence": entry("Archive alert emails", []),
  "overview.rec.notifications.reason": entry(
    "Automated alerts, not emails from people. Review opens the list — nothing is archived until you approve.",
    [],
  ),
  "overview.scan.progress": entry("{processed, number} of {total, number} emails sorted", [
    "processed",
    "total",
  ]),
  "overview.scan.progressNoTotal": entry("{processed, number} emails sorted so far", ["processed"]),
  "overview.nothingToCatch": entry("Nothing needs you right now.", []),
  "overview.nothingToClean": entry("Nothing to clean up right now.", []),
  "overview.empty.title": entry("No emails yet", []),
  "overview.empty.description": entry(
    "Connect an account and I will start sorting on this device.",
    [],
  ),
  "overview.empty.action": entry("Connect an account", []),
  "overview.syncing.title": entry("Syncing your first emails", []),
  "overview.syncing.description": entry(
    "Nothing is sorted yet. I read your mail on this device; if this stays empty, try again.",
    [],
  ),
  "overview.worker.unavailable": entry("I could not load your overview.", []),
  "overview.retry": entry("Try again", []),
  "overview.scan.paused": entry("Paused. Nothing was changed.", []),
  "overview.loading": entry("Loading your overview", []),
  ...summaryMessages.en,
  "sync.progress": entry("Syncing your email", []),
  "shell.loading": entry("Starting…", []),
  "shell.error.title": entry("Something went wrong", []),
  "shell.error.body": entry("Pochimail hit a problem. Close and reopen the app to try again.", []),
  "tray.open": entry("Open Pochimail", []),
  "tray.quit": entry("Quit Pochimail", []),
  "welcome.headline": entry("Clean up your email. Keep what matters.", []),
  "welcome.description": entry(
    "Pochimail is a private assistant for the email accounts you already have. It flags what needs you, clears the clutter and saves your documents. Your email never leaves this {device}.",
    ["device"],
  ),
  "welcome.cta": entry("Get started", []),
  "welcome.openSource": entry("Free and open source", []),
  "onboarding.progress": entry("Step {current} of {total}", ["current", "total"]),
  ...connectMessages.en,
  ...storageMessages.en,
  "setup.title": entry("Set up", []),
  "setup.description": entry("Choose how Pochi can help.", []),
  "setup.bubble": entry(
    "Hi, I'm Pochi. Tell me what to help with and how much I'm allowed to do. You can change this anytime in Settings.",
    [],
  ),
  "setup.capabilities.heading": entry("What should I help with?", []),
  "setup.capabilities.hint": entry("Choose any", []),
  "setup.capability.catch-what-matters.title": entry("Catch what matters", []),
  "setup.capability.catch-what-matters.description": entry(
    "Flag people waiting on you, deadlines and important senders.",
    [],
  ),
  "setup.capability.declutter.title": entry("Declutter", []),
  "setup.capability.declutter.description": entry(
    "Unsubscribe and archive what you don't need.",
    [],
  ),
  "setup.capability.organize.title": entry("Organize", []),
  "setup.capability.organize.description": entry(
    "Sort email into clear categories and topics, as labels.",
    [],
  ),
  "setup.capability.save-documents.title": entry("Save documents", []),
  "setup.capability.save-documents.description": entry(
    "Find attachments that matter and keep them in a folder.",
    [],
  ),
  "setup.autonomy.heading": entry("How much can I do?", []),
  "setup.autonomy.recommended": entry("Recommended", []),
  "setup.autonomy.just-look.title": entry("Just look", []),
  "setup.autonomy.just-look.description": entry("I show you, but never change anything.", []),
  "setup.autonomy.suggest.title": entry("Suggest", []),
  "setup.autonomy.suggest.description": entry("I prepare, you approve each step.", []),
  "setup.autonomy.autopilot.title": entry("Autopilot", []),
  "setup.autonomy.autopilot.description": entry("I handle the obvious, then tell you.", []),
  "setup.autonomy.autopilot.reminder": entry(
    "With Autopilot I only archive or unsubscribe when I'm at least {percent}% sure, and I never touch email from real people. I log everything and report it afterward. You can undo it, except an unsubscribe.",
    ["percent"],
  ),
  "setup.invariants": entry(
    "In every mode, I never act on email from real people without asking. I log every action, and you can undo any of them except an unsubscribe.",
    [],
  ),
  "setup.capabilities.none": entry("Choose at least one thing for me to help with.", []),
  "setup.settingsError": entry("I couldn't load your choices.", []),
  "setup.retry": entry("Try again", []),
  "setup.start": entry("Start sorting", []),
  "setup.error": entry("I couldn't start sorting. Please try again.", []),
  "documents.title": entry("Documents", []),
  "activity.title": entry("Activity", []),
  "settings.title": entry("Settings", []),
  "settings.description": entry("Preferences and account settings will appear here.", []),
  ...settingsMessages.en,
  "nav.brand": entry("Pochimail", []),
  "nav.label": entry("Main navigation", []),
  "nav.email": entry("Email", []),
  "nav.tools": entry("Tools", []),
  "nav.teams": entry("Teams", []),
  "nav.soon": entry("Soon", []),
  "switcher.menu": entry("Account", []),
  "switcher.all": entry("All accounts", []),
  "switcher.add": entry("Add another account", []),
  "nav.empty": entry("{name}, empty", ["name"]),
  "nav.topics": entry("Topics", []),
  "type.personal": entry("Personal", []),
  "type.transactional": entry("Transactional", []),
  "type.notification": entry("Alert emails", []),
  "type.newsletter": entry("Newsletters", []),
  "type.promotion": entry("Promotions", []),
  ...notificationMessages.en,
  "devGallery.title": entry("Dev gallery", []),
  "devGallery.description": entry("States and motion previews for development.", []),
  "devGallery.dark": entry("Dark theme", []),
  "devGallery.reduceMotion": entry("Reduce motion", []),
  "devGallery.states": entry("States", []),
  "devGallery.motion": entry("Motion", []),
  "storageBar.description": entry("{summary}: {items}", ["summary", "items"]),
  "storageBar.descriptionItem": entry("{size} {label}", ["size", "label"]),
  "storageBar.itemSeparator": entry(", ", []),
  "storageBar.legendItem": entry("{label} · {size}", ["label", "size"]),
  "state.signInCancelled.title": entry("Sign-in was cancelled", []),
  "state.signInCancelled.body": entry(
    "No problem. I didn’t get access to anything. You can try again whenever you’re ready.",
    [],
  ),
  "state.signInCancelled.retry": entry("Try again", []),
  "state.signInCancelled.other": entry("Choose another account", []),
  "state.offline.title": entry("You’re offline", []),
  "state.offline.body": entry(
    "Keep browsing as usual. I’ll sync again and apply what you approved as soon as you’re back.",
    [],
  ),
  "state.offline.dismiss": entry("Got it", []),
  "state.reconnect.title": entry("I lost access to your {provider} account", ["provider"]),
  "state.reconnect.body": entry(
    "{provider} asked you to sign in again. Your sorting and settings are safe.",
    ["provider"],
  ),
  "state.reconnect.action": entry("Reconnect", []),
  "state.reconnect.remove": entry("Remove account", []),
  "state.modelFailed.title": entry("The assistant model didn’t download", []),
  "state.modelFailed.body": entry(
    "I can still sort with simple rules while you retry. Results will be a bit less precise.",
    [],
  ),
  "state.modelFailed.retry": entry("Retry download", []),
  "state.modelFailed.rules": entry("Continue with rules", []),
  "state.rateLimit.title": entry("{provider} is slowing me down", ["provider"]),
  "state.rateLimit.body": entry(
    "Large mailboxes hit the limits of {provider}. I’ll continue automatically in {minutes, plural, one {# minute} other {# minutes}}.",
    ["provider", "minutes"],
  ),
  "state.rateLimit.dismiss": entry("Got it", []),
  "state.emptyActivity.title": entry("Nothing yet", []),
  "state.emptyActivity.body": entry(
    "When I archive, delete or unsubscribe for you, it shows up here with an Undo where one is possible.",
    [],
  ),
  "state.emptyDocuments.title": entry("Nothing saved yet", []),
  "state.emptyDocuments.body": entry(
    "Documents I save for you will appear here, on this device.",
    [],
  ),
  "state.emptyCategory.title": entry("Nothing to clean here", []),
  "state.emptyCategory.body": entry(
    "This category is already tidy. I’ll let you know when that changes.",
    [],
  ),
  "state.emptyCategory.action": entry("Back to overview", []),
  "state.nothingToDo.title": entry("All caught up", []),
  "state.nothingToDo.body": entry(
    "Nothing needs you right now. I’ll tell you when that changes.",
    [],
  ),
  "state.nothingToDo.action": entry("Back to overview", []),
} as const;
export type MessageKey = keyof typeof messages;
/** Params are derived from the catalog entry, so a renamed placeholder breaks the call site. */
export type MessageValues<K extends MessageKey> = {
  readonly [Param in (typeof messages)[K]["params"][number]]: string | number;
};

/**
 * A shipped catalog must cover every English key with the same placeholders, so a missing
 * translation (or a dropped `{device}`) fails typecheck instead of silently showing English.
 */
export type Catalog = {
  readonly [K in MessageKey]: {
    readonly text: string;
    readonly params: (typeof messages)[K]["params"];
  };
};
