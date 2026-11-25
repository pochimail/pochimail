import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { AiUnavailable } from "@pochimail/classification/errors";
import type { EmailType } from "@pochimail/classification/model/email-type";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { AuthExpired, type ProviderError, RateLimited } from "@pochimail/kernel/errors";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { createInMemoryUnitOfWork } from "../in-memory-store.ts";
import { mailProviderContract } from "../mail-provider-contract.ts";
import { runSyncContract } from "../sync-contract.ts";
import { createGmailHarness, withOwners } from "./gmail-harness.ts";

// Guards: the Gmail adapter drifting from the provider and sync contracts every adapter must meet.
mailProviderContract(() => {
  const { provider, deliver } = createGmailHarness({ pageSize: 2 });
  return { provider, deliver };
});

runSyncContract(() => {
  const { provider, server, clock, deliver } = createGmailHarness({ pageSize: 2 });
  const owners = new Map<string, Pick<IncomingMessage, "workspaceId" | "accountId">>();
  const store = createInMemoryUnitOfWork();
  const labels = new Map<string, EmailType>();
  const classifier = createGroundTruthClassifier(labels);
  let next = 0;
  return {
    uow: store.uow,
    secrets: createInMemorySecretStore(),
    provider: withOwners(provider, owners),
    clock,
    ids: { next: (prefix) => `${prefix}_${++next}` },
    labels,
    classifier,
    makeClassifierUnavailable: () => classifier.faults.failWith(new AiUnavailable(), { times: 1 }),
    deliver: (...messages) => {
      for (const m of messages)
        owners.set(m.id, { workspaceId: m.workspaceId, accountId: m.accountId });
      deliver(...messages);
    },
    setBody: (id, body) => server.setBody(id, body),
    failNextSync: (error: ProviderError) => {
      if (error instanceof RateLimited) {
        server.failNext(429, { retryAfter: String((error.retryAfterMs ?? 1000) / 1000) });
      } else if (error instanceof AuthExpired) server.failNext(401, { times: 2 });
      else server.failNext(500);
    },
    snapshot: store.snapshot,
    committedOutbox: store.committedOutbox,
  };
});
