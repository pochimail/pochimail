import type { KeepRuleRepository } from "@pochimail/cleanup/ports/keep-rule-repository";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { createAccountRepository } from "./accounts/account-repository.ts";
import { createActionLogRepository } from "./actions/action-log-repository.ts";
import { createDerivedRepository } from "./classification/derived-repository.ts";
import { createSignalRepository } from "./classification/signal-repository.ts";
import { createTopicRepository } from "./classification/topic-repository.ts";
import { createDigestStateRepository } from "./cleanup/digest-state-repository.ts";
import { createKeepRuleRepository } from "./cleanup/keep-rule-repository.ts";
import { createSuggestionRepository } from "./cleanup/suggestion-repository.ts";
import { createCursorRepository } from "./mailbox/cursor-repository.ts";
import { createMessageRepository } from "./mailbox/message-repository.ts";
import { createSenderRepository } from "./mailbox/sender-repository.ts";
import { createThreadRepository } from "./mailbox/thread-repository.ts";
import { mailboxFactsOver } from "./read-models/mailbox-facts.ts";
import { overviewFiguresOver } from "./read-models/overview-figures.ts";
import { signalFactsOver } from "./read-models/signal-facts.ts";
import type { RepositoryContext } from "./shared/repository-context.ts";
import type { ReadRepositories, WriteRepositories } from "./unit-of-work-types.ts";

/** Every repository's statements and logic, bound to one connection (synchronous). */
export function createSqliteCore(db: Database, context: RepositoryContext) {
  return {
    accounts: createAccountRepository(db),
    messages: createMessageRepository(db, context),
    threads: createThreadRepository(db, context.cache),
    derived: createDerivedRepository(db, context),
    senders: createSenderRepository(db, context),
    suggestions: createSuggestionRepository(db, context),
    actionLog: createActionLogRepository(db),
    topics: createTopicRepository(db),
    cursors: createCursorRepository(db),
    signals: createSignalRepository(db, context),
    digestState: createDigestStateRepository(db),
    keepRules: createKeepRuleRepository(db),
  };
}

/** Repositories bound to one connection; every query is parameterised and workspace-scoped. */
export function createSqliteRepositories(
  db: Database,
  context: RepositoryContext,
): {
  reads: ReadRepositories;
  writes: WriteRepositories;
  keepRules: KeepRuleRepository;
} {
  const core = createSqliteCore(db, context);
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
    countByTopic: lift(core.messages.countByTopic),
  };
  const derived = {
    get: lift(core.derived.get),
    listForMessages: lift(core.derived.listForMessages),
    list: lift(core.derived.list),
  };
  const threads = { get: lift(core.threads.get) };
  const senders = {
    get: lift(core.senders.get),
    list: lift(core.senders.list),
    ofMessage: lift(core.senders.ofMessage),
  };
  const suggestions = {
    get: lift(core.suggestions.get),
    listPending: lift(core.suggestions.listPending),
  };
  const actionLog = {
    get: lift(core.actionLog.get),
    listForAction: lift(core.actionLog.listForAction),
    listForKey: lift(core.actionLog.listForKey),
    listForBatch: lift(core.actionLog.listForBatch),
    lastSeq: lift(core.actionLog.lastSeq),
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
      setTopics: lift(core.messages.setTopics),
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
  return { reads, writes, keepRules: core.keepRules };
}
