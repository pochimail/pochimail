import { accountStateEvent } from "@pochimail/accounts/events";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox } from "@pochimail/testing/fixture-mailbox/generator";
import { describe, expect, it, vi } from "vitest";
import { DEMO_SEED } from "../shared/demo.ts";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";

const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));

describe("classifier cache and account removal", () => {
  it("an account being disconnected clears the classifier cache (guards mail-derived answers outliving the account)", async () => {
    const adapters = await createFixtureAdapters({
      scale: "small",
      timer: createFakeTimer(),
      logger: createLogger({ sink: { write: () => {} } }),
      deviceName: () => "Mac",
      classifier: createGroundTruthClassifier(labels),
      newJobId: () => "job-1",
    });
    const accountId = mailbox.accounts[0]?.id ?? "";
    const stored = await adapters.uow.run((tx) =>
      tx.events.append([
        accountStateEvent({
          workspaceId: unwrap(WorkspaceId(mailbox.workspaceId)),
          accountId: unwrap(AccountId(accountId)),
          state: "disconnected",
          occurredAt: new Date().toISOString(),
        }),
      ]),
    );
    expect(stored.ok).toBe(true);
    const clear = vi.fn();

    const app = createWorkerApp({ ...adapters, clearClassifierCache: clear });
    await app.idle();

    await vi.waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  });
});
