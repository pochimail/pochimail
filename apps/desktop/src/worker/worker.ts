import { createLogger } from "@pochimail/logger/logger";
import type { Timer } from "@pochimail/pipeline/event-batching";
import { DEMO_PACED_PAGE_SIZE, demoFirstRun, demoScale, demoScanPaceMs } from "../shared/demo.ts";
import type { Handlers } from "../shared/ipc/server.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { createPlatformAdapter } from "../shared/platform.ts";
import { DEFAULT_APP_SETTINGS } from "../shared/settings.ts";
import { DATABASE_CLOSED } from "../shared/worker-shutdown.ts";
import { createAccountsRuntime } from "./accounts-runtime.ts";
import { createWorkerApp } from "./app.ts";
import { createModelHostClient } from "./model-host-client.ts";
import { acceptPorts } from "./ports.ts";
import { acceptStart, type WorkerStart } from "./start.ts";

// Runs inside Electron's utilityProcess: the composition root of the app (M4-02).
const platform = createPlatformAdapter(process.platform, process.cwd());
const timer: Timer = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
const logger = createLogger({
  sink: {
    write: (record) =>
      console.warn(
        JSON.stringify({ level: record.level, message: record.message, ...record.fields }),
      ),
  },
});

// A graceful shutdown from main releases the database handle before the worker stops.
let closeDatabase: (() => void) | undefined;
let shuttingDown = false;
const requestShutdown = (): void => {
  shuttingDown = true;
  const close = closeDatabase;
  closeDatabase = undefined;
  if (close === undefined) return;
  close();
  // Main waits for this before it stops the process, so the handle is never cut off mid-close.
  process.parentPort.postMessage(DATABASE_CLOSED);
};

// Models run in their own process; main hands this worker a new port every time that process (re)starts.
const modelHost = createModelHostClient({ timer });
process.parentPort.on("message", (event) => {
  const type = (event.data as { type?: unknown } | null | undefined)?.type;
  if (type === "shutdown") requestShutdown();
  if (type === "model-host-unavailable") modelHost.markUnavailable();
  if (type !== "model-port") return;
  const port = event.ports[0];
  if (port === undefined) return;
  modelHost.attach({
    post: (message) => port.postMessage(message),
    onMessage: (handler) => port.on("message", (portEvent) => handler(portEvent.data)),
    onClose: (handler) => port.on("close", handler),
    close: () => port.close(),
  });
  port.start();
});

// The database key and the keychain-backed SecretStore come from main in one start message.
const started = new Promise<WorkerStart>((resolve) => acceptStart(process.parentPort, resolve));

// Only accounts are real so far; every other query answers empty until its adapters land. Demo mode (dev/E2E) has fixture data.
const emptyHandlers: Handlers = {
  procedures: {
    "app.state": () => ({ status: "ready", hasConnectedAccount: false }),
    "device.name": () => platform.deviceName(),
    "accounts.list": () => [],
    "accounts.connect": () => ({ status: "failed" as const, reason: "unknown" as const }),
    "overview.get": () => ({
      scanned: 0,
      toReview: 0,
      waiting: 0,
      deadlines: 0,
      important: 0,
      oldestWaitingDays: 0,
      cleanable: [],
      figures: {
        archived: 0,
        savedCount: 0,
        savedSize: 0,
        deletableSize: 0,
        unsubscribed: 0,
        totalSize: 0,
      },
    }),
    // Without storage there is no account, so Review has counts only and no session to apply a choice.
    "review.get": () => ({
      toReview: 0,
      waiting: 0,
      deadlines: 0,
      important: 0,
      cleanable: [],
      noAccount: true,
    }),
    "mailbox.categories": () => ({
      people: 0,
      records: 0,
      "purchases-travel": 0,
      "sign-ins-security": 0,
      notifications: 0,
      newsletters: 0,
      promotions: 0,
    }),
    "scan.status": () => [],
    "digest.get": () => ({ ready: false, itemCount: 0, archived: 0, saved: 0, unsubscribed: 0 }),
    "settings.get": () => DEFAULT_APP_SETTINGS,
  },
  subscriptions: {
    "app.events": () => undefined,
    "scan.progress": () => undefined,
  },
};

/** Without storage there is no sign-in to run: say why instead of answering a generic failure after a click. */
const unavailableHandlers: Handlers = {
  ...emptyHandlers,
  procedures: {
    ...emptyHandlers.procedures,
    "accounts.connect": () => ({
      status: "failed" as const,
      reason: "storage-unavailable" as const,
    }),
  },
};

/**
 * Demo mode has no Google: "connecting" answers with the first fixture account, so onboarding can be tried end to end.
 * In first-run demo mode (E2E) no account is visible until that connect, as in a fresh install.
 */
const withDemoConnect = (demo: Handlers, firstRun: boolean): Handlers => {
  let connected = !firstRun;
  const list = (): ReturnType<NonNullable<Handlers["procedures"]["accounts.list"]>> =>
    connected ? (demo.procedures["accounts.list"]?.(undefined) ?? []) : [];
  return {
    ...demo,
    procedures: {
      ...demo.procedures,
      "accounts.list": list,
      ...(firstRun
        ? {
            "app.state": async () => ({
              status: "ready" as const,
              hasConnectedAccount: (await list()).length > 0,
            }),
          }
        : {}),
      "accounts.connect": async () => {
        connected = true;
        const [first] = await list();
        return first === undefined
          ? { status: "failed" as const, reason: "unknown" as const }
          : { status: "connected" as const, accountId: first.id };
      },
    },
  };
};

/** The real app over the empty answers; with no database key or an unopenable file they stay empty. */
const realHandlers = async (): Promise<Handlers> => {
  const start = await started;
  const app = createAccountsRuntime(start, {
    env: process.env,
    timer,
    logger,
    deviceName: () => platform.deviceName(),
    classifier: modelHost.classifier,
    clearClassifierCache: () => void modelHost.clearCache(),
  });
  if (app === undefined) return unavailableHandlers;
  closeDatabase = app.close;
  if (shuttingDown) requestShutdown();
  return {
    procedures: { ...emptyHandlers.procedures, ...app.handlers.procedures },
    subscriptions: { ...emptyHandlers.subscriptions, ...app.handlers.subscriptions },
  };
};

const scale = demoScale(process.env.POCHIMAIL_DEMO);
const pageDelayMs = demoScanPaceMs(process.env.POCHIMAIL_DEMO_SCAN_PACE_MS);
const paceOptions =
  pageDelayMs === undefined ? {} : { pageDelayMs, pageSize: DEMO_PACED_PAGE_SIZE };
const handlers: Promise<Handlers> =
  scale === undefined
    ? realHandlers()
    : import("./fixture-adapters.ts")
        .then(({ createFixtureAdapters }) =>
          createFixtureAdapters({
            scale,
            timer,
            logger,
            deviceName: () => platform.deviceName(),
            classifier: modelHost.classifier,
            newJobId: () => crypto.randomUUID(),
            ...paceOptions,
          }),
        )
        .then((adapters) =>
          withDemoConnect(
            createWorkerApp(adapters).handlers,
            demoFirstRun(process.env.POCHIMAIL_DEMO_FIRST_RUN),
          ),
        )
        .catch(() => {
          logger.error("demo data failed to load", { operation: "start" });
          return emptyHandlers;
        });

acceptPorts(process.parentPort, (port) => {
  let dispose: (() => void) | undefined;
  let closed = false;
  void handlers.then((ready) => {
    if (closed) return;
    dispose = serveRpc(
      {
        post: (message) => port.postMessage(message),
        onMessage: (handler) => port.on("message", (portEvent) => handler(portEvent.data)),
        onClose: (handler) => port.on("close", handler),
        close: () => port.close(),
      },
      ready,
    );
    port.start();
  });
  return () => {
    closed = true;
    dispose?.();
  };
});
