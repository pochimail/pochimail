import type { Classifier } from "@pochimail/classification/ports/classifier";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeClock } from "@pochimail/testing/fake-clock";
import { createFakeMailProvider } from "@pochimail/testing/fake-mail-provider";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox, MAILBOX_SCALES } from "@pochimail/testing/fixture-mailbox/generator";
import { ACCOUNT_1, makeAccount, makeIncomingMessage, WS_A } from "@pochimail/testing/fixtures";
import { createInMemoryJobQueue } from "@pochimail/testing/in-memory-job-queue";
import { createInMemoryUnitOfWork } from "@pochimail/testing/in-memory-store";
import { describe, expect, it, vi } from "vitest";
import { DEMO_SEED } from "../shared/demo.ts";
import { createRpcClient } from "../shared/ipc/client.ts";
import type { EventOf } from "../shared/ipc/contract.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";
import { createWorkerApp, type WorkerAdapters } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";
import { createInMemorySettingsStore } from "./in-memory-settings-store.ts";

const silent = createLogger({ sink: { write: () => {} } });
const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
const groundTruth = () => createGroundTruthClassifier(labels);

/** The real RPC layer over a MessageChannel, exactly as the renderer and the worker talk. */
const connect = async (options: { classifier?: Classifier; adapters?: WorkerAdapters } = {}) => {
  let jobs = 0;
  const adapters =
    options.adapters ??
    (await createFixtureAdapters({
      scale: "small",
      timer: createFakeTimer(),
      logger: silent,
      deviceName: () => "Mac",
      classifier: options.classifier ?? groundTruth(),
      newJobId: () => `job-${++jobs}`,
    }));
  const app = createWorkerApp(adapters);
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), app.handlers);
  const client = createRpcClient(fromDomPort(port1));
  const appEvents: EventOf<"app.events">[] = [];
  client.subscribe("app.events", undefined, (event) => appEvents.push(event));
  return {
    app,
    client,
    appEvents,
    adapters,
    close: () => {
      port1.close();
      port2.close();
    },
  };
};

const FIRST_ACCOUNT = mailbox.accounts[0]?.id ?? "";
const accountSize = (id: string) =>
  mailbox.labels.messages.filter((l) => l.accountId === id).length;

describe("worker app over the real IPC layer", () => {
  it("a scan streams ScanProgressed, then ScanCompleted, then DigestReady (guards a renderer that never learns the scan ended)", async () => {
    const { client, appEvents, close } = await connect();
    const progress: EventOf<"scan.progress">[] = [];
    client.subscribe("scan.progress", { accountId: FIRST_ACCOUNT }, (event) =>
      progress.push(event),
    );
    await client.call("scan.start", { accountId: FIRST_ACCOUNT });

    await vi.waitFor(() => expect(appEvents.map((e) => e.type)).toContain("DigestReady"));
    const types = appEvents.map((e) => e.type);
    expect(types.indexOf("ScanCompleted")).toBeLessThan(types.indexOf("DigestReady"));
    const counts = progress.map((e) => e.processed);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(progress.at(-1)).toMatchObject({
      phase: "done",
      processed: accountSize(FIRST_ACCOUNT),
    });
    expect(await client.call("digest.get", { accountId: FIRST_ACCOUNT })).toMatchObject({
      ready: true,
    });
    const otherAccount = mailbox.accounts.find((a) => a.id !== FIRST_ACCOUNT)?.id;
    if (otherAccount !== undefined)
      expect(await client.call("digest.get", { accountId: otherAccount })).toMatchObject({
        ready: false,
        itemCount: 0,
      });
    close();
  });

  it("pause stops at a batch boundary and resume finishes without losing or repeating an email (guards a double count or a scan that never completes)", async () => {
    const real = groundTruth();
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Holds the second batch, so the test can pause while the scan is demonstrably in the middle.
    const classifier: Classifier = {
      classify: async (messages, signal) => {
        calls += 1;
        if (calls === 2) await gate;
        return real.classify(messages, signal);
      },
    };
    const { client, app, appEvents, close } = await connect({ classifier });
    const progress: EventOf<"scan.progress">[] = [];
    client.subscribe("scan.progress", { accountId: FIRST_ACCOUNT }, (event) =>
      progress.push(event),
    );
    const { jobId } = await client.call("scan.start", { accountId: FIRST_ACCOUNT });

    await vi.waitFor(() =>
      expect(progress.at(-1)).toMatchObject({ phase: "classifying", processed: 100 }),
    );
    await client.call("scan.pause", { jobId });
    // The worker, not the screen, knows the scan is paused (a reloaded screen asks this).
    expect(await client.call("scan.status", { accountIds: [FIRST_ACCOUNT] })).toMatchObject([
      { jobId, status: "paused" },
    ]);
    release();
    await app.idle();
    expect(appEvents.map((e) => e.type)).not.toContain("ScanCompleted");

    await client.call("scan.resume", { jobId });
    await vi.waitFor(() => expect(appEvents.map((e) => e.type)).toContain("ScanCompleted"));
    await app.idle();
    expect(appEvents.filter((e) => e.type === "ScanCompleted")).toEqual([
      { type: "ScanCompleted", accountId: FIRST_ACCOUNT, processed: accountSize(FIRST_ACCOUNT) },
    ]);
    expect((await client.call("overview.get", {})).scanned).toBe(accountSize(FIRST_ACCOUNT));
    expect(await client.call("scan.status", { accountIds: [FIRST_ACCOUNT] })).toEqual([]);
    close();
  });

  it("cancelling a live scan tells the renderer and removes the job (guards a progress bar that outlives the scan)", async () => {
    // Guards: cancellation with no app.events signal, so the renderer cannot clear the indicator.
    const real = groundTruth();
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const classifier: Classifier = {
      classify: async (messages, signal) => {
        calls += 1;
        if (calls === 2) await gate;
        return real.classify(messages, signal);
      },
    };
    const { client, app, appEvents, close } = await connect({ classifier });
    const { jobId } = await client.call("scan.start", { accountId: FIRST_ACCOUNT });
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));

    await client.call("scan.cancel", { jobId });
    release();
    await app.idle();

    await vi.waitFor(() =>
      expect(appEvents).toContainEqual({
        type: "ScanCancelled",
        accountId: FIRST_ACCOUNT,
        jobId,
      }),
    );
    expect(await client.call("scan.status", { accountIds: [FIRST_ACCOUNT] })).toEqual([]);
    close();
  });

  it("the overview counts every email of the scanned fixture and lists both accounts (guards a scan that drops mail or an account)", async () => {
    const { client, app, close } = await connect();
    for (const account of mailbox.accounts)
      await client.call("scan.start", { accountId: account.id });
    await app.idle();
    const overview = await client.call("overview.get", {});
    // The small fixture is the brief §6 mock dataset at about 1 %; `full` is exactly MOCK_DATASET.totalMessages.
    expect(overview.scanned).toBe(mailbox.labels.totals.messages);
    expect(mailbox.labels.totals.messages).toBe(MAILBOX_SCALES.small);
    expect(await client.call("accounts.list")).toHaveLength(2);
    close();
  });

  it("the overview of one account counts only that account and the structure adds up (guards an Overview that ignores the account switcher)", async () => {
    const { client, app, close } = await connect();
    for (const account of mailbox.accounts)
      await client.call("scan.start", { accountId: account.id });
    await app.idle();
    const all = await client.call("overview.get", {});
    const [first, second] = await Promise.all(
      mailbox.accounts.map((a) => client.call("overview.get", { accountId: a.id })),
    );
    expect(first?.scanned).toBe(accountSize(FIRST_ACCOUNT));
    expect((first?.scanned ?? 0) + (second?.scanned ?? 0)).toBe(all.scanned);
    expect(all.toReview).toBe(all.waiting + all.deadlines + all.important);
    // Numbers come from the real detectors: assert the shape, never the brief's 22 (known M3 gap).
    const counts = await client.call("mailbox.categories", {
      accountIds: mailbox.accounts.map((a) => a.id),
    });
    for (const { category, count } of all.cleanable) expect(count).toBe(counts[category]);
    expect(all.cleanable.map((c) => c.count)).toEqual(
      [...all.cleanable.map((c) => c.count)].sort((a, b) => b - a),
    );
    close();
  });

  it("a second adapter bundle runs the same handlers with no handler change (guards business wiring leaking into the handlers)", async () => {
    const clock = createFakeClock(new Date("2026-01-02T00:00:00.000Z"));
    const store = createInMemoryUnitOfWork();
    const provider = createFakeMailProvider({ pageSize: 2 });
    provider.deliver(makeIncomingMessage(1), makeIncomingMessage(2), makeIncomingMessage(3));
    const account = makeAccount();
    await store.uow.run((tx) => tx.repositories.accounts.save(account));
    const { client, app, close } = await connect({
      adapters: {
        workspaceId: WS_A,
        clock,
        random: () => 0.5,
        timer: createFakeTimer(),
        logger: silent,
        newJobId: () => "job-fake",
        uow: store.uow,
        outboxStore: store.outboxStore,
        queue: createInMemoryJobQueue(clock),
        settings: createInMemorySettingsStore(),
        classifier: createFakeClassifier(),
        providerFor: () => provider,
        deviceName: () => "PC",
      },
    });
    expect(await client.call("device.name")).toBe("PC");
    expect(await client.call("accounts.list")).toEqual([
      { id: ACCOUNT_1, provider: "google", displayName: account.address },
    ]);
    await client.call("scan.start", { accountId: ACCOUNT_1 });
    await app.idle();
    expect((await client.call("overview.get", {})).scanned).toBe(3);
    close();
  });

  it("a scan that cannot reach the provider announces ScanFailed and can be started again (guards a silent failed scan)", async () => {
    const clock = createFakeClock(new Date("2026-01-02T00:00:00.000Z"));
    const store = createInMemoryUnitOfWork();
    const provider = createFakeMailProvider();
    provider.deliver(makeIncomingMessage(1));
    provider.simulateOffline();
    await store.uow.run((tx) => tx.repositories.accounts.save(makeAccount()));
    let jobs = 0;
    const { client, app, appEvents, close } = await connect({
      adapters: {
        workspaceId: WS_A,
        clock,
        random: () => 0.5,
        timer: createFakeTimer(),
        logger: silent,
        newJobId: () => `job-${++jobs}`,
        uow: store.uow,
        outboxStore: store.outboxStore,
        queue: createInMemoryJobQueue(clock),
        settings: createInMemorySettingsStore(),
        classifier: createFakeClassifier(),
        providerFor: () => provider,
        deviceName: () => "Mac",
      },
    });
    await client.call("scan.start", { accountId: ACCOUNT_1 });
    await vi.waitFor(() =>
      expect(appEvents).toContainEqual({
        type: "ScanFailed",
        accountId: ACCOUNT_1,
        reason: "offline",
      }),
    );
    await app.idle();
    provider.faults.clear();
    const again = await client.call("scan.start", { accountId: ACCOUNT_1 });
    expect(again.jobId).toBe("job-2");
    await vi.waitFor(() => expect(appEvents.map((e) => e.type)).toContain("ScanCompleted"));
    close();
  });

  it("settings changes keep the fields the patch did not name (guards a toggle silently resetting Autopilot)", async () => {
    const { client, close } = await connect();
    await client.call("settings.update", { notifications: false });
    expect(await client.call("settings.get")).toMatchObject({
      autonomy: "suggest",
      notifications: false,
    });
    await client.call("settings.update", { autonomy: "autopilot" });
    expect(await client.call("settings.get")).toMatchObject({
      autonomy: "autopilot",
      notifications: false,
    });
    close();
  });

  it("a scan for an unknown account fails with a typed error that names no cause (guards leaking internals to the page)", async () => {
    const { client, close } = await connect();
    await expect(client.call("scan.start", { accountId: "acc-unknown" })).rejects.toMatchObject({
      code: "HANDLER_FAILED",
      message: "scan.start failed",
    });
    close();
  });
});
