import { PartiallyApplied } from "@pochimail/actions/ports/mail-commands";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { SuggestionId } from "@pochimail/cleanup/model/suggestion";
import { ProviderFailed } from "@pochimail/kernel/errors";
import { MessageId } from "@pochimail/kernel/ids";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox } from "@pochimail/testing/fixture-mailbox/generator";
import { expect, vi } from "vitest";
import { DEMO_SEED } from "#shared/demo.ts";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { createWorkerApp, type WorkerAdapters } from "../app.ts";
import { createFixtureAdapters } from "../fixture-adapters.ts";

/** Test harness for the cleanup and activity procedures: the real IPC layer over the fixture adapters. */
const silent = createLogger({ sink: { write: () => {} } });
export const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
export const ACCOUNT = mailbox.accounts[0]?.id ?? "";

export interface Spy {
  calls: string[];
  /** Makes the next provider call fail after applying the first message of its command. */
  failNext: boolean;
}

/** The fixture adapters with a provider that records what reaches it. */
export const makeAdapters = async (): Promise<{ adapters: WorkerAdapters; spy: Spy }> => {
  let jobs = 0;
  const base = await createFixtureAdapters({
    scale: "small",
    timer: createFakeTimer(),
    logger: silent,
    deviceName: () => "Mac",
    classifier: createGroundTruthClassifier(labels),
    newJobId: () => `job-${++jobs}`,
  });
  const spy: Spy = { calls: [], failNext: false };
  const adapters: WorkerAdapters = {
    ...base,
    providerFor: (account) => {
      const provider = base.providerFor(account);
      return {
        ...provider,
        applyCommands: async (commands, signal) => {
          spy.calls.push(...commands.map((c) => c.kind));
          const first = commands[0];
          if (spy.failNext && first !== undefined) {
            spy.failNext = false;
            const done = await provider.applyCommands(
              [{ ...first, messageIds: first.messageIds.slice(0, 1) as typeof first.messageIds }],
              signal,
            );
            return {
              ok: false,
              error: new PartiallyApplied(new ProviderFailed("boom"), done.ok ? done.value : []),
            };
          }
          return provider.applyCommands(commands, signal);
        },
      };
    },
  };
  return { adapters, spy };
};

/** The real RPC layer over a MessageChannel; a second call on the same adapters is a worker restart. */
export const open = (adapters: WorkerAdapters) => {
  const app = createWorkerApp(adapters);
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), app.handlers);
  const client = createRpcClient(fromDomPort(port1));
  const events: EventOf<"app.events">[] = [];
  client.subscribe("app.events", undefined, (event) => events.push(event));
  return {
    app,
    client,
    events,
    close: () => {
      port1.close();
      port2.close();
    },
  };
};

export const scanned = async (adapters: WorkerAdapters) => {
  const session = open(adapters);
  await session.client.call("scan.start", { accountId: ACCOUNT });
  await session.app.idle();
  await vi.waitFor(async () =>
    expect((await session.client.call("cleanup.suggestions", {})).length).toBeGreaterThan(0),
  );
  return session;
};

/** The ids behind a suggestion, read from the store like the worker does (the screen never sends them yet). */
export const idsOf = async (adapters: WorkerAdapters, id: string) => {
  const made = SuggestionId(id);
  if (!made.ok) throw made.error;
  const found = await adapters.uow.reads.suggestions.get(adapters.workspaceId, made.value);
  if (!found.ok) throw found.error;
  return found.value.recommendation.messageIds as string[];
};

/** An archive suggestion and how many of its messages the demo history already archived (the figure counts stored marks). */
export const archiveSuggestion = async (
  adapters: WorkerAdapters,
  suggestions: { id: string; kind: string }[],
) => {
  const suggestion = suggestions.find((s) => s.kind === "archive");
  if (suggestion === undefined) throw new Error("the fixture proposes no archive");
  const ids = await idsOf(adapters, suggestion.id);
  let already = 0;
  for (const id of ids) {
    const made = MessageId(id);
    if (!made.ok) throw made.error;
    const stored = await adapters.uow.reads.messages.get(adapters.workspaceId, made.value);
    if (stored.ok && stored.value.archived === true) already += 1;
  }
  return { ...suggestion, ids, already };
};
