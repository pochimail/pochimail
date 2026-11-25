import { AiUnavailable } from "@pochimail/classification/errors";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import {
  createFakeEmbedder,
  createFakeLlmProvider,
} from "@pochimail/classification/testing/fake-ai";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox } from "@pochimail/testing/fixture-mailbox/generator";
import type { MessagePortMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { type HostProcess, superviseModelHost } from "../main/model-host-supervisor.ts";
import { serveModelHost } from "../model-host/serve.ts";
import { DEMO_SEED } from "../shared/demo.ts";
import { createRpcClient } from "../shared/ipc/client.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";
import { createModelHostClient } from "./model-host-client.ts";

const silent = createLogger({ sink: { write: () => {} } });
const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
const FIRST_ACCOUNT = mailbox.accounts[0]?.id ?? "";
const FIRST_ACCOUNT_SIZE = mailbox.labels.messages.filter(
  (l) => l.accountId === FIRST_ACCOUNT,
).length;

/** A model host process in memory: serves its engine on the port it is given, answers pings unless muted, dies on `kill`. */
const createFakeHostFactory = (engineFor: (generation: number) => Classifier) => {
  const hosts: { kill: () => void; mute: () => void }[] = [];
  const fork = (): HostProcess => {
    const generation = hosts.length;
    const listeners = {
      message: [] as ((m: unknown) => void)[],
      exit: [] as ((c: number) => void)[],
    };
    let muted = false;
    let dead = false;
    let port: MessagePort | undefined;
    const host = {
      postMessage: (message: unknown, transfer?: MessagePortMain[]) => {
        const type = (message as { type: string }).type;
        if (type === "port") {
          port = transfer?.[0] as unknown as MessagePort;
          port.start();
          serveModelHost(fromDomPort(port), {
            classifier: engineFor(generation),
            llm: createFakeLlmProvider(),
            embedder: createFakeEmbedder(),
          });
        } else if (type === "ping" && !muted && !dead)
          for (const l of listeners.message) l({ type: "pong", n: (message as { n: number }).n });
      },
      on: ((event: "message" | "exit", listener: never) => {
        listeners[event].push(listener);
      }) as HostProcess["on"],
      kill: () => {
        if (dead) return;
        dead = true;
        port?.close();
        for (const l of listeners.exit) l(1);
      },
    };
    hosts.push({ kill: host.kill, mute: () => (muted = true) });
    return host;
  };
  return { fork, hosts };
};

const wire = (engineFor: (generation: number) => Classifier, options: { waitMs?: number } = {}) => {
  const timer = createFakeTimer();
  const client = createModelHostClient({ timer, ...options });
  const factory = createFakeHostFactory(engineFor);
  const supervisor = superviseModelHost({
    fork: factory.fork,
    worker: {
      postMessage: (_message, [port]) => {
        const ours = port as unknown as MessagePort;
        ours.start();
        client.attach(fromDomPort(ours));
      },
    },
    createChannel: () => new MessageChannel() as never,
    timer,
    logger: silent,
  });
  return { timer, client, supervisor, ...factory };
};

describe("model host process", () => {
  it("killing the host does not take the worker down: it restarts and the scan continues (guards a model crash ending the scan or the app)", async () => {
    // The first host hangs on its first request, as a model stuck mid-inference would; the second one answers.
    const wired = wire((generation) =>
      generation === 0
        ? { classify: () => new Promise(() => {}) }
        : createGroundTruthClassifier(labels),
    );
    let jobs = 0;
    const adapters = await createFixtureAdapters({
      scale: "small",
      timer: wired.timer,
      logger: silent,
      deviceName: () => "Mac",
      classifier: wired.client.classifier,
      newJobId: () => `job-${++jobs}`,
    });
    const app = createWorkerApp(adapters);
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();
    serveRpc(fromDomPort(port2), app.handlers);
    const rpc = createRpcClient(fromDomPort(port1));
    const events: string[] = [];
    rpc.subscribe("app.events", undefined, (event) => events.push(event.type));

    await rpc.call("scan.start", { accountId: FIRST_ACCOUNT });
    await vi.waitFor(() => expect(wired.hosts).toHaveLength(1));
    wired.hosts[0]?.kill();

    // The worker keeps answering while the host is gone...
    expect(await rpc.call("app.state")).toMatchObject({ status: "ready" });
    // ...and once the supervisor has restarted the host the same scan finishes.
    wired.timer.advance(500);
    await vi.waitFor(() => expect(events).toContain("ScanCompleted"));
    await app.idle();
    expect(wired.hosts).toHaveLength(2);
    expect((await rpc.call("overview.get", {})).scanned).toBe(FIRST_ACCOUNT_SIZE);
    wired.supervisor.stop();
    port1.close();
    port2.close();
  });

  it("a host that stops answering pings is killed and replaced (guards a hung model blocking every scan)", () => {
    const wired = wire(() => createGroundTruthClassifier(labels));
    expect(wired.hosts).toHaveLength(1);
    wired.hosts[0]?.mute();
    wired.timer.advance(5_000); // ping goes unanswered
    wired.timer.advance(5_000); // the next beat finds it unanswered and replaces it
    wired.timer.advance(500);
    expect(wired.hosts).toHaveLength(2);
    wired.supervisor.stop();
  });

  it("a crash-looping host is restarted with a growing delay (guards a fork storm)", () => {
    const wired = wire(() => createGroundTruthClassifier(labels));
    wired.hosts[0]?.kill();
    wired.timer.advance(499);
    expect(wired.hosts).toHaveLength(1);
    wired.timer.advance(1);
    expect(wired.hosts).toHaveLength(2);
    wired.hosts[1]?.kill();
    wired.timer.advance(999);
    expect(wired.hosts).toHaveLength(2);
    wired.timer.advance(1);
    expect(wired.hosts).toHaveLength(3);
    wired.supervisor.stop();
  });

  it("stopping the supervisor kills the host and never restarts it (guards an orphaned model process after the window closes)", () => {
    const wired = wire(() => createGroundTruthClassifier(labels));
    wired.supervisor.stop();
    wired.timer.advance(60_000);
    expect(wired.hosts).toHaveLength(1);
  });

  it("a request with no host to answer fails as AiUnavailable after the wait (guards a scan hanging forever)", async () => {
    const timer = createFakeTimer();
    const client = createModelHostClient({ timer, waitMs: 1_000 });
    const result = client.classifier.classify([], {
      aborted: false,
      addEventListener() {},
      removeEventListener() {},
    });
    timer.advance(1_000);
    expect(await result).toEqual({ ok: false, error: expect.any(AiUnavailable) });
  });

  it("a malformed request is dropped and the host stays up (guards a bad message killing the model host)", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();
    serveModelHost(fromDomPort(port2), undefined);
    const replies: unknown[] = [];
    port1.onmessage = (event) => replies.push(event.data);
    port1.postMessage({ id: 1, method: "classify", messages: "not a list" });
    port1.postMessage({ id: 2, method: "complete", prompt: "hi" });
    await vi.waitFor(() => expect(replies).toEqual([{ id: 2, ok: false, error: "unavailable" }]));
    port1.close();
    port2.close();
  });

  it("after repeated start failures the supervisor gives up and the worker sees the model as unavailable (guards an endless fork loop and a scan waiting forever)", async () => {
    const timer = createFakeTimer();
    const client = createModelHostClient({ timer });
    const factory = createFakeHostFactory(() => createGroundTruthClassifier(labels));
    const toWorker: unknown[] = [];
    const supervisor = superviseModelHost({
      fork: factory.fork,
      worker: {
        postMessage: (message) => {
          toWorker.push(message);
          if ((message as { type: string }).type === "model-host-unavailable")
            client.markUnavailable();
        },
      },
      createChannel: () => new MessageChannel() as never,
      timer,
      logger: silent,
      maxConsecutiveFailures: 3,
    });
    const waiting = client.classifier.classify([], {
      aborted: false,
      addEventListener() {},
      removeEventListener() {},
    });
    for (let i = 0; i < 3; i++) {
      factory.hosts[i]?.kill();
      timer.advance(15_000);
    }
    expect(factory.hosts).toHaveLength(3); // no fourth fork
    expect(toWorker).toContainEqual({ type: "model-host-unavailable" });
    expect(await waiting).toEqual({ ok: false, error: expect.any(AiUnavailable) });
    supervisor.stop();
  });

  it("an engine that throws gets an unavailable answer and the host keeps serving (guards one bad request killing the model host)", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();
    let calls = 0;
    serveModelHost(fromDomPort(port2), {
      classifier: {
        classify: async () => {
          calls += 1;
          if (calls === 1) throw new Error("boom");
          return { ok: true, value: [] };
        },
      },
      llm: createFakeLlmProvider(),
      embedder: createFakeEmbedder(),
    });
    const replies: unknown[] = [];
    port1.onmessage = (event) => replies.push(event.data);
    port1.postMessage({ id: 1, method: "classify", messages: [] });
    port1.postMessage({ id: 2, method: "classify", messages: [] });
    await vi.waitFor(() =>
      expect(replies).toEqual([
        { id: 1, ok: false, error: "unavailable" },
        { id: 2, ok: true, result: [] },
      ]),
    );
    port1.close();
    port2.close();
  });

  it("clearing the cache reaches the engine behind the host (guards mail-derived answers staying in the host after account removal or lock)", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.start();
    port2.start();
    let cleared = 0;
    serveModelHost(fromDomPort(port2), {
      classifier: createGroundTruthClassifier(labels),
      llm: createFakeLlmProvider(),
      embedder: createFakeEmbedder(),
      clearCache: () => {
        cleared += 1;
      },
    });
    const client = createModelHostClient({ timer: createFakeTimer() });
    client.attach(fromDomPort(port1));

    await client.clearCache();

    expect(cleared).toBe(1);
    port1.close();
    port2.close();
  });
});
