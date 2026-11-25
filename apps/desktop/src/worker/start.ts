import type { SecretStore } from "@pochimail/accounts/ports/secret-store";
import { z } from "zod";
import { createBrowserOpener } from "../shared/ipc/open-browser.ts";
import { createSecretsClient, type ProtectionState } from "../shared/ipc/secrets.ts";
import type { Transport } from "../shared/ipc/transport.ts";

const startSchema = z.object({
  type: z.literal("start"),
  /** The per-user database file, chosen by main from Electron's userData (never read from the ambient environment). */
  databasePath: z.string().min(1),
  /** Raw key bytes, as main holds them; the worker zeroes them once the database is open. */
  databaseKey: z.instanceof(Uint8Array).optional(),
});

export type WorkerStart = {
  readonly databasePath: string;
  /** Undefined when main could not protect a key; the worker must not open the database then. Zeroed after the database is opened. */
  databaseKey: Buffer | undefined;
  secrets: SecretStore & { protection: () => Promise<ProtectionState> };
  /** Asks main to open a provider consent page in the system browser (never in an app window). */
  openBrowser: (url: string) => Promise<void>;
};

type SecretsPort = {
  postMessage: (message: unknown) => void;
  on: (event: "message", listener: (event: { data: unknown }) => void) => void;
  start: () => void;
};

/** The worker's private channels need only two methods; RPC teardown hooks are not part of them. */
type WorkerTransport = Pick<Transport, "post" | "onMessage">;

/** Adapter: a `SecretStore` whose every call is answered by the main process (the only place `safeStorage` works). */
const createWorkerSecretStore = (transport: WorkerTransport, timeoutMs?: number) => {
  const client = createSecretsClient(transport, timeoutMs);
  return client;
};

/** Receives main's `start` message (the only message that carries the secrets port). */
export const acceptStart = (
  parent: {
    on: (
      event: "message",
      listener: (event: { data: unknown; ports: SecretsPort[] }) => void,
    ) => void;
  },
  onStart: (start: WorkerStart) => void,
): void => {
  parent.on("message", (event) => {
    const parsed = startSchema.safeParse(event.data);
    const port = event.ports[0];
    if (!parsed.success || port === undefined) return;
    const transport: WorkerTransport = {
      post: (message) => port.postMessage(message),
      onMessage: (handler) => port.on("message", (messageEvent) => handler(messageEvent.data)),
    };
    port.start();
    onStart({
      databasePath: parsed.data.databasePath,
      databaseKey:
        parsed.data.databaseKey === undefined
          ? undefined
          : Buffer.from(
              parsed.data.databaseKey.buffer,
              parsed.data.databaseKey.byteOffset,
              parsed.data.databaseKey.byteLength,
            ),
      secrets: createWorkerSecretStore(transport),
      openBrowser: createBrowserOpener(transport),
    });
  });
};
