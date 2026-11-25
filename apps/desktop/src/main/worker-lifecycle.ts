import type { Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import type { Timer } from "@pochimail/pipeline/event-batching";
import type { MessageChannelMain, WebContents } from "electron";
import { databaseClosedSchema } from "../shared/worker-shutdown.ts";
import { type HostProcess, superviseModelHost } from "./model-host-supervisor.ts";
import type { SecretVault } from "./secret-vault.ts";
import type { DatabaseKeyError } from "./storage-key.ts";
import { linkWorkerOnEveryLoad } from "./worker-link.ts";
import { bootWorker } from "./worker-start.ts";

/** A worker that dies this many times without staying up for `STABLE_MS` is left dead and logged. */
const MAX_RESTARTS = 3;
const STABLE_MS = 60_000;
/** How long a worker may take to release the database before it is stopped anyway. */
const SHUTDOWN_GRACE_MS = 3_000;

export type WindowPort = {
  webContents: Pick<WebContents, "on" | "off" | "postMessage" | "reload">;
  once: (event: "closed", listener: () => void) => unknown;
};

/** Everything that touches the OS, so the order of startup and shutdown can be driven without Electron. */
export type WorkerLifecyclePorts = {
  forkWorker: () => HostProcess;
  forkModelHost: () => HostProcess;
  createChannel: () => MessageChannelMain;
  timer: Timer;
  secrets: SecretVault;
  databasePath: string;
  /** The storage gate: waits for the person's choice, then hands a fresh copy of the key each time. */
  loadKey: () => Promise<Result<Buffer | undefined, DatabaseKeyError>>;
  openExternal: (url: string) => Promise<void>;
  logger: Logger;
};

type Running = {
  worker: HostProcess;
  stop: () => void;
  exited: Promise<void>;
  databaseClosed: Promise<void>;
  booted: Promise<boolean>;
};

/**
 * One worker (with its model host) per window. The key comes from the storage gate for every start, so a second window
 * and a restarted worker reuse the person's one choice. An unexpected exit restarts the worker and reloads the page so it
 * gets a fresh port; closing a window, or quitting, asks the worker to release the database before stopping it.
 */
export const createWorkerLifecycle = (ports: WorkerLifecyclePorts) => {
  const { logger, timer } = ports;
  const closers = new Set<() => Promise<void>>();

  const connect = (window: WindowPort): void => {
    let closing: Promise<void> | undefined;
    let restarts = 0;
    let current: Running | undefined;

    const launch = (): void => {
      const worker = ports.forkWorker();
      const modelHost = superviseModelHost({
        fork: ports.forkModelHost,
        worker,
        createChannel: ports.createChannel,
        timer,
        logger,
      });
      const unlink = linkWorkerOnEveryLoad(window.webContents, worker, ports.createChannel);
      const cancelStable = timer.set(() => {
        restarts = 0;
      }, STABLE_MS);
      let markExited = (): void => undefined;
      let markClosed = (): void => undefined;
      const running: Running = {
        worker,
        stop: () => {
          modelHost.stop();
          unlink();
          cancelStable();
        },
        exited: new Promise((resolve) => (markExited = resolve)),
        databaseClosed: new Promise((resolve) => (markClosed = resolve)),
        booted: bootWorker({
          worker,
          secrets: ports.secrets,
          databasePath: ports.databasePath,
          loadKey: ports.loadKey,
          createChannel: ports.createChannel,
          openExternal: ports.openExternal,
          logger,
        }),
      };
      current = running;
      worker.on("message", (message) => {
        if (databaseClosedSchema.safeParse(message).success) markClosed();
      });
      worker.on("exit", () => {
        running.stop();
        markExited();
        // A worker stopped because it has no key is not restarted: it would only fail the same way.
        void running.booted.then((started) => {
          if (started && closing === undefined && current === running) restart();
        });
      });
    };

    const restart = (): void => {
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        logger.error("worker keeps failing, giving up", { operation: "worker" });
        current = undefined;
        return;
      }
      logger.warn("worker exited, restarting", { operation: "worker" });
      launch();
      // The old page port died with the worker; a load hands the page a new one.
      window.webContents.reload();
    };

    const close = (): Promise<void> => {
      closing ??= (async () => {
        const running = current;
        current = undefined;
        if (running === undefined) return;
        running.stop();
        running.worker.postMessage({ type: "shutdown" }, []);
        await new Promise<void>((resolve) => {
          const cancel = timer.set(resolve, SHUTDOWN_GRACE_MS);
          void Promise.race([running.databaseClosed, running.exited]).then(() => {
            cancel();
            resolve();
          });
        });
        running.worker.kill();
      })();
      void closing.finally(() => closers.delete(close));
      return closing;
    };

    closers.add(close);
    window.once("closed", () => void close());
    launch();
  };

  return {
    connect,
    /** Resolves once every worker has released its database (or the grace period ended). Call before the app quits. */
    shutdown: async (): Promise<void> => {
      await Promise.all([...closers].map((close) => close()));
    },
  };
};

export type WorkerLifecycle = ReturnType<typeof createWorkerLifecycle>;
