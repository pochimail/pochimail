import { accountRepositoryContract } from "@pochimail/accounts/testing/account-repository-contract";
import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { describeActionUseCases } from "@pochimail/actions/testing/action-contract";
import { BASE_CAPABILITIES, createActionHarness } from "@pochimail/actions/testing/action-harness";
import { AiUnavailable } from "@pochimail/classification/errors";
import { type Category, PROTECTED_CATEGORIES } from "@pochimail/classification/model/category";
import { derivedContract } from "@pochimail/classification/testing/derived-contract";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { signalRepositoryContract } from "@pochimail/classification/testing/signal-repository-contract";
import { signalsContract } from "@pochimail/classification/testing/signals-contract";
import { signalsSafetyContract } from "@pochimail/classification/testing/signals-safety-contract";
import type { KeepRuleRepository } from "@pochimail/cleanup/ports/keep-rule-repository";
import { digestContract } from "@pochimail/cleanup/testing/digest-contract";
import { digestStateContract } from "@pochimail/cleanup/testing/digest-state-contract";
import { createInMemoryKeepRuleRepository } from "@pochimail/cleanup/testing/in-memory-keep-rule-repository";
import { keepRuleRepositoryContract } from "@pochimail/cleanup/testing/keep-rule-repository-contract";
import { suggestionRepositoryContract } from "@pochimail/cleanup/testing/suggestion-repository-contract";
import { suggestionsContract } from "@pochimail/cleanup/testing/suggestions-contract";
import type { ProviderError } from "@pochimail/kernel/errors";
import { mailboxRepositoryContract } from "@pochimail/mailbox/testing/mailbox-repository-contract";
import { createFakeClock } from "@pochimail/testing/fake-clock";
import { createFakeMailProvider } from "@pochimail/testing/fake-mail-provider";
import { figuresContract } from "@pochimail/testing/figures-contract";
import { repositoriesContract } from "@pochimail/testing/repositories-contract";
import { runSyncContract } from "@pochimail/testing/sync-contract";
import { harness, uowHarness } from "./test-support/harness.ts";
import { classificationSeeder, cleanupSeeder } from "./test-support/seeders.ts";

// Keep rules are a standalone port: prove the in-memory adapter and the SQLite one agree.
const sqliteKeepRules = (h: ReturnType<typeof harness>): KeepRuleRepository => ({
  list: (ws, account, hash) => h.uow.run((tx) => tx.keepRules.list(ws, account, hash)),
  save: (rule) => h.uow.run((tx) => tx.keepRules.save(rule)),
});
keepRuleRepositoryContract(createInMemoryKeepRuleRepository);
keepRuleRepositoryContract(() => sqliteKeepRules(harness()));

// The domain packages' own repository contracts, then every exported contract suite, unchanged, against SQLite (none skipped).
accountRepositoryContract(uowHarness);
describeActionUseCases("sqlite", () =>
  createActionHarness({ ...BASE_CAPABILITIES, batchModify: null }, harness().uow),
);
mailboxRepositoryContract(uowHarness);
repositoriesContract(uowHarness);
figuresContract(uowHarness);
derivedContract(uowHarness);
signalRepositoryContract(uowHarness);
digestStateContract(uowHarness);
const signalsHarness = () => {
  const h = harness();
  const labels = new Map<string, Category>();
  return {
    ...classificationSeeder(h),
    uow: h.uow,
    clock: createFakeClock(),
    classifier: createGroundTruthClassifier(labels),
    labels,
    snapshot: h.snapshot,
  };
};
signalsContract(signalsHarness);
signalsSafetyContract(signalsHarness);
suggestionRepositoryContract(uowHarness);
suggestionsContract(() => {
  const h = harness();
  return {
    ...cleanupSeeder(h),
    uow: h.uow,
    clock: createFakeClock(),
    protectedLabels: PROTECTED_CATEGORIES,
  };
});
digestContract(() => {
  const h = harness();
  return { ...cleanupSeeder(h), uow: h.uow, clock: createFakeClock() };
});
runSyncContract(() => {
  const h = harness();
  const provider = createFakeMailProvider({ pageSize: 2 });
  const labels = new Map<string, Category>();
  const classifier = createGroundTruthClassifier(labels);
  let next = 0;
  return {
    uow: h.uow,
    secrets: createInMemorySecretStore(),
    provider,
    clock: createFakeClock(),
    ids: { next: (prefix: string) => `${prefix}_${++next}` },
    labels,
    classifier,
    makeClassifierUnavailable: () => classifier.faults.failWith(new AiUnavailable(), { times: 1 }),
    deliver: provider.deliver,
    setBody: provider.setBody,
    failNextSync: (error: ProviderError) => provider.faults.failWith(error, { times: 1 }),
    snapshot: h.snapshot,
    committedOutbox: h.committedOutbox,
  };
});
