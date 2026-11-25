import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { Message } from "@pochimail/mailbox/model/message";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { createAccountRepository } from "./accounts/account-repository.ts";
import { createActionLogRepository } from "./actions/action-log-repository.ts";
import { createDerivedRepository } from "./classification/derived-repository.ts";
import { createSignalRepository } from "./classification/signal-repository.ts";
import { createTopicRepository } from "./classification/topic-repository.ts";
import { createDigestStateRepository } from "./cleanup/digest-state-repository.ts";
import { createSuggestionRepository } from "./cleanup/suggestion-repository.ts";
import { createCursorRepository } from "./mailbox/cursor-repository.ts";
import { createMessageRepository } from "./mailbox/message-repository.ts";
import { createSearchRepository } from "./mailbox/search-repository.ts";
import { createSenderRepository } from "./mailbox/sender-repository.ts";
import { createThreadRepository } from "./mailbox/thread-repository.ts";
import { mailboxFactsOver } from "./read-models/mailbox-facts.ts";
import { overviewFiguresOver } from "./read-models/overview-figures.ts";
import { signalFactsOver } from "./read-models/signal-facts.ts";
import type { ReadRepositories, WriteRepositories } from "./unit-of-work-types.ts";

/** Every repository's statements and logic, bound to one connection (synchronous). */
export function createSqliteCore(db: Database) {
  return {
    accounts: createAccountRepository(db),
    messages: createMessageRepository(db),
    threads: createThreadRepository(db),
    derived: createDerivedRepository(db),
    senders: createSenderRepository(db),
    suggestions: createSuggestionRepository(db),
    actionLog: createActionLogRepository(db),
    topics: createTopicRepository(db),
    cursors: createCursorRepository(db),
    signals: createSignalRepository(db),
    digestState: createDigestStateRepository(db),
    search: createSearchRepository(db),
  };
}

/** Full-text search over metadata and derived data (sender, subject, snippet, category, signals). */
export interface MessageSearch {
  /** Best match first; the last word may be a prefix. Never matches message bodies: none are stored. */
  search(
    ws: Message["workspaceId"],
    accountId: Message["accountId"],
    text: string,
    limit: number,
  ): AsyncResult<readonly Message[], StorageError>;
}

/** Repositories bound to one connection; every query is parameterised and workspace-scoped. */
export function createSqliteRepositories(db: Database): {
  reads: ReadRepositories;
  writes: WriteRepositories;
  search: MessageSearch;
} {
  const core = createSqliteCore(db);
  // The core is synchronous (better-sqlite3 is); the ports are async.
  const lift =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A) =>
      Promise.resolve(fn(...args));

  const accounts = {
    get: lift(core.accounts.get),
    list: lift(core.accounts.list),
  };
  const messages = {
    get: lift(core.messages.get),
    query: lift(core.messages.query),
    latestSequence: lift(core.messages.latestSequence),
    countByCategory: lift(core.messages.countByCategory),
  };
  const derived = { get: lift(core.derived.get), list: lift(core.derived.list) };
  const threads = { get: lift(core.threads.get) };
  const senders = { get: lift(core.senders.get), list: lift(core.senders.list) };
  const suggestions = {
    get: lift(core.suggestions.get),
    listPending: lift(core.suggestions.listPending),
  };
  const actionLog = {
    get: lift(core.actionLog.get),
    listForAction: lift(core.actionLog.listForAction),
    listForKey: lift(core.actionLog.listForKey),
    listForBatch: lift(core.actionLog.listForBatch),
    listPending: lift(core.actionLog.listPending),
    list: lift(core.actionLog.list),
  };
  const topics = { get: lift(core.topics.get), list: lift(core.topics.list) };
  const cursors = { get: lift(core.cursors.get) };
  const signals = { listForMessages: lift(core.signals.listForMessages) };
  const digestState = {
    get: lift(core.digestState.get),
    getSequence: lift(core.digestState.getSequence),
  };

  const base = {
    accounts,
    messages,
    threads,
    derived,
    senders,
    suggestions,
    actionLog,
    topics,
    cursors,
    signals,
    digestState,
  };
  const reads: ReadRepositories = {
    ...base,
    signalFacts: signalFactsOver(base),
    mailboxFacts: mailboxFactsOver({ ...base, figures: lift(overviewFiguresOver(db)) }),
  };
  const writes: WriteRepositories = {
    accounts: { ...accounts, save: lift(core.accounts.save), remove: lift(core.accounts.remove) },
    messages: {
      ...messages,
      upsertMany: lift(core.messages.upsertMany),
      setCategory: lift(core.messages.setCategory),
    },
    threads: { ...threads, upsert: lift(core.threads.upsert) },
    derived: { ...derived, save: lift(core.derived.save) },
    senders: { ...senders, upsert: lift(core.senders.upsert) },
    suggestions: { ...suggestions, save: lift(core.suggestions.save) },
    actionLog: { ...actionLog, append: lift(core.actionLog.append) },
    topics: { ...topics, save: lift(core.topics.save) },
    cursors: { ...cursors, set: lift(core.cursors.set) },
    signals: { ...signals, replaceForMessages: lift(core.signals.replaceForMessages) },
    digestState: { ...digestState, set: lift(core.digestState.set) },
  };
  return { reads, writes, search: { search: lift(core.search) } };
}
