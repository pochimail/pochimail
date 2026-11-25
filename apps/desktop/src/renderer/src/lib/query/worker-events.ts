import type { RpcClient } from "#shared/ipc/client.ts";
import type { EventOf } from "#shared/ipc/contract.ts";
import type { OptimisticActionRegistry } from "./optimistic.ts";

const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4000;

type AppEventHandlers = {
  readonly registry: OptimisticActionRegistry;
  readonly onMailboxChanged: () => void;
  readonly onScanFailed: () => void;
  readonly onScanEnded: () => void;
  readonly onDigestReady: () => void;
  readonly onSyncChanged: (finished: boolean) => void;
};

/** Routes one global app event to the reconciliation or shell callback that owns it. */
const dispatchAppEvent = (event: EventOf<"app.events">, handlers: AppEventHandlers): void => {
  switch (event.type) {
    case "ActionApplied":
      handlers.registry.apply(event.actionId);
      handlers.onMailboxChanged();
      break;
    case "ScanCompleted":
      handlers.onMailboxChanged();
      break;
    case "ActionFailed":
      handlers.registry.fail(event.actionId);
      break;
    case "ScanFailed":
      handlers.onScanFailed();
      handlers.onScanEnded();
      break;
    case "ScanCancelled":
      handlers.onScanEnded();
      break;
    case "DigestReady":
      handlers.onDigestReady();
      break;
    case "SyncChanged":
      handlers.onSyncChanged(!event.running);
      break;
  }
};

/** Subscribes to global app events and reconciles optimistic mutations on ActionApplied/ActionFailed. */
export const subscribeAppEvents = (
  client: RpcClient,
  registry: OptimisticActionRegistry,
  onScanFailed: () => void = () => {},
  /** Emails were scanned or moved: counts derived from the mailbox are stale. */
  onMailboxChanged: () => void = () => {},
  /** A scan ended without completing: the shell's progress state must be re-read. */
  onScanEnded: () => void = () => {},
  /** A digest was tallied: the summary's counts must be re-read. */
  onDigestReady: () => void = () => {},
  /** A sync started or ended: the shell's Sync now state must be re-read, and the figures when it ended. */
  onSyncChanged: (finished: boolean) => void = () => {},
): (() => void) => {
  let closed = false;
  let currentUnsubscribe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = INITIAL_BACKOFF_MS;

  const connect = () => {
    if (closed) return;
    try {
      currentUnsubscribe = client.subscribe(
        "app.events",
        undefined,
        (event: EventOf<"app.events">) => {
          backoffMs = INITIAL_BACKOFF_MS;
          dispatchAppEvent(event, {
            registry,
            onMailboxChanged,
            onScanFailed,
            onScanEnded,
            onDigestReady,
            onSyncChanged,
          });
        },
        (error) => {
          console.error("[app.events]", error.code);
          registry.failAll();
          currentUnsubscribe = undefined;
          if (closed) return;
          retryTimer = setTimeout(connect, backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        },
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "UNKNOWN";
      console.error("[app.events]", code);
      registry.failAll();
      currentUnsubscribe = undefined;
      if (closed) return;
      retryTimer = setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  };

  connect();
  return () => {
    closed = true;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    currentUnsubscribe?.();
    currentUnsubscribe = undefined;
  };
};
