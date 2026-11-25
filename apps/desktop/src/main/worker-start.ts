import type { Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import type { MessageChannelMain, MessagePortMain } from "electron";
import { serveOpenBrowser } from "../shared/ipc/open-browser.ts";
import { serveSecrets } from "../shared/ipc/secrets.ts";
import type { SecretVault } from "./secret-vault.ts";
import type { DatabaseKeyError } from "./storage-key.ts";

/**
 * Hands the worker what only main can produce: the database path, its key and a private port to the keychain
 * service and to the system browser. The port goes to the worker alone, never to a WebContents. Without a key
 * (no keychain, no user choice yet) the worker starts without one and must not open the database.
 */
export const startWorker = (
  worker: { postMessage: (message: unknown, transfer: MessagePortMain[]) => void },
  secrets: SecretVault,
  databaseKey: Buffer | undefined,
  databasePath: string,
  createChannel: () => Pick<MessageChannelMain, "port1" | "port2">,
  openExternal: (url: string) => Promise<void> = async () => {
    throw new Error("no system browser");
  },
): void => {
  const { port1, port2 } = createChannel();
  const transport = {
    post: (message: unknown) => port1.postMessage(message),
    onMessage: (handler: (data: unknown) => void) =>
      port1.on("message", (event) => handler(event.data)),
  };
  serveSecrets(transport, secrets);
  serveOpenBrowser(transport, openExternal);
  port1.start();
  worker.postMessage(
    {
      type: "start",
      databasePath,
      ...(databaseKey === undefined ? {} : { databaseKey }),
    },
    [port2],
  );
};

/**
 * Loads the database key, then starts the worker. If the key cannot be produced the worker is NOT started (it is
 * killed): failing loudly beats running keyless or on a fresh key. The failure is logged by reason only. The key buffer
 * is zeroed once handed over, so `loadKey` must return a buffer nobody else reads afterwards.
 */
export const bootWorker = async (options: {
  worker: {
    postMessage: (message: unknown, transfer: MessagePortMain[]) => void;
    kill: () => void;
  };
  secrets: SecretVault;
  /** Resolved once from Electron's per-user userData directory; never an ambient environment variable. */
  databasePath: string;
  loadKey: () => Promise<Result<Buffer | undefined, DatabaseKeyError>>;
  createChannel: () => Pick<MessageChannelMain, "port1" | "port2">;
  /** Main opens the system browser for sign-in; the worker only ever asks for a consent URL. */
  openExternal?: (url: string) => Promise<void>;
  logger: Logger;
}): Promise<boolean> => {
  const { worker, secrets, loadKey, createChannel, logger } = options;
  const key = await loadKey().catch(() => undefined);
  if (key === undefined || !key.ok) {
    // The reason is part of the fixed message (the logger redacts free-form field values).
    const reason = (key?.ok === false ? key.error.reason : "unexpected").replaceAll("-", " ");
    logger.error(`database key unavailable (${reason}), worker not started`, {
      operation: "start",
      code: "storage.failed",
    });
    worker.kill();
    return false;
  }
  startWorker(
    worker,
    secrets,
    key.value,
    options.databasePath,
    createChannel,
    options.openExternal,
  );
  key.value?.fill(0);
  return true;
};
