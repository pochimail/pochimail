import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { AiUnavailable } from "@pochimail/classification/errors";
import type { EmailType } from "@pochimail/classification/model/email-type";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import type { ProviderError } from "@pochimail/kernel/errors";
import { createFakeClock } from "./fake-clock.ts";
import { createFakeMailProvider } from "./fake-mail-provider.ts";
import { createInMemoryUnitOfWork } from "./in-memory-store.ts";
import { runSyncContract } from "./sync-contract.ts";

runSyncContract(() => {
  const store = createInMemoryUnitOfWork();
  const provider = createFakeMailProvider({ pageSize: 2 });
  const labels = new Map<string, EmailType>();
  const classifier = createGroundTruthClassifier(labels);
  let next = 0;
  return {
    uow: store.uow,
    secrets: createInMemorySecretStore(),
    provider,
    clock: createFakeClock(),
    ids: { next: (prefix) => `${prefix}_${++next}` },
    labels,
    classifier,
    makeClassifierUnavailable: () => classifier.faults.failWith(new AiUnavailable(), { times: 1 }),
    deliver: provider.deliver,
    setBody: provider.setBody,
    failNextSync: (error: ProviderError) => provider.faults.failWith(error, { times: 1 }),
    snapshot: store.snapshot,
    committedOutbox: store.committedOutbox,
  };
});
