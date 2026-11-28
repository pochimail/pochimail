import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox } from "@pochimail/testing/fixture-mailbox/generator";
import { notifierContract } from "@pochimail/testing/notifier-contract";
import { describe, expect, it, vi } from "vitest";
import { DEMO_SEED } from "../shared/demo.ts";
import { createRpcClient } from "../shared/ipc/client.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";
import type { NotifyMessage } from "../shared/notifications.ts";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";
import { createInMemorySettingsStore } from "./in-memory-settings-store.ts";
import { createMainNotifier } from "./main-notifier.ts";
import { ManageSettings } from "./manage-settings.ts";

const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
const WORKSPACE = unwrap(WorkspaceId(mailbox.workspaceId));

notifierContract(() => {
  const sent: NotifyMessage[] = [];
  const notifier = createMainNotifier({
    settings: new ManageSettings({ store: createInMemorySettingsStore() }),
    workspaceId: WORKSPACE,
    send: (message) => void sent.push(message),
  });
  return { notifier, shown: () => sent.map(({ kind, count }) => ({ kind, count })) };
});

const start = async () => {
  const adapters = await createFixtureAdapters({
    scale: "small",
    timer: createFakeTimer(),
    logger: createLogger({ sink: { write: () => {} } }),
    deviceName: () => "Mac",
    classifier: createGroundTruthClassifier(labels),
    newJobId: () => "job-1",
  });
  const sent: NotifyMessage[] = [];
  const app = createWorkerApp({ ...adapters, sendNotification: (m) => void sent.push(m) });
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), app.handlers);
  const client = createRpcClient(fromDomPort(port1));
  const events: string[] = [];
  client.subscribe("app.events", undefined, (event) => events.push(event.type));
  const scan = async () => {
    await client.call("scan.start", { accountId: mailbox.accounts[0]?.id ?? "" });
    await vi.waitFor(() => expect(events).toContain("DigestReady"));
    await app.idle();
  };
  return {
    client,
    sent,
    scan,
    close: () => {
      port1.close();
      port2.close();
    },
  };
};

describe("the worker's notifications", () => {
  it("a finished scan sends a kind and a count and nothing else, in the saved language (guards content leaving the worker)", async () => {
    const run = await start();
    await run.client.call("settings.update", { locale: "ja" });

    await run.scan();

    expect(run.sent.map((m) => m.kind).sort()).toEqual(["digest-ready", "scan-complete"]);
    for (const message of run.sent) {
      expect(Object.keys(message).sort()).toEqual(["count", "kind", "locale", "type"]);
      expect(message.count).toBeGreaterThan(0);
      expect(message.locale).toBe("ja");
    }
    run.close();
  });

  it("switching notifications off sends nothing (guards the switch controlling nothing)", async () => {
    const run = await start();
    await run.client.call("settings.update", { notifications: false });

    await run.scan();

    expect(run.sent).toEqual([]);
    run.close();
  });
});
