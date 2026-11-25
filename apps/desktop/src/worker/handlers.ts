import type { Account } from "@pochimail/accounts/model/account";
import type { ListAccounts } from "@pochimail/accounts/use-cases/list-accounts";
import type { CountCategories } from "@pochimail/classification/use-cases/count-categories";
import type { GetDigestStatus } from "@pochimail/cleanup/use-cases/get-digest-status";
import type { GetOverview } from "@pochimail/cleanup/use-cases/get-overview";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { AccountId } from "@pochimail/kernel/ids";
import type { EventBus } from "@pochimail/pipeline/event-bus";
import type { DomainEvent } from "@pochimail/workflows/events";
import type { ScanRunner } from "@pochimail/workflows/use-cases/scan-runner";
import type { EventOf, OutputOf } from "../shared/ipc/contract.ts";
import type { Handlers } from "../shared/ipc/server.ts";
import type { DeviceName } from "../shared/platform-port.ts";
import type { ManageSettings } from "./manage-settings.ts";

/**
 * What the handlers may touch: domain use cases and the event bus, nothing else. No repositories, no adapters, no
 * business rules here (ADR 0002 / M4-02): a handler parses its input, calls one use case and shapes the answer.
 */
export interface HandlerDeps {
  readonly workspaceId: WorkspaceId;
  readonly listAccounts: ListAccounts;
  readonly getOverview: GetOverview;
  readonly categories: CountCategories;
  readonly digestStatus: GetDigestStatus;
  readonly settings: ManageSettings;
  readonly scans: ScanRunner;
  readonly events: Pick<EventBus<DomainEvent>, "subscribe">;
  readonly deviceName: () => DeviceName;
}

const PROVIDERS: Record<Account["provider"], OutputOf<"accounts.list">[number]["provider"]> = {
  gmail: "google",
  graph: "microsoft",
};

type FailureReason = Extract<EventOf<"app.events">, { type: "ActionFailed" }>["reason"];

type ScanFailureReason = Extract<EventOf<"app.events">, { type: "ScanFailed" }>["reason"];

const scanFailureReason = (code: string): ScanFailureReason => {
  if (code === "provider.offline") return "offline";
  if (code === "provider.rate_limited") return "rate-limited";
  if (code === "provider.auth_expired") return "auth-expired";
  return "unknown";
};

const failureReason = (code: string): FailureReason => {
  if (code === "storage.not_found") return "not-found";
  if (code === "provider.conflict") return "conflict";
  if (code === "operation.cancelled") return "cancelled";
  if (code.startsWith("provider.")) return "provider-error";
  return "unknown";
};

/** A failed use case becomes a thrown error: the RPC layer answers HANDLER_FAILED without forwarding the cause. */
const unwrapOrThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

export function createHandlers(deps: HandlerDeps): Handlers {
  const { workspaceId } = deps;
  // UI-only events have no domain counterpart: tell every app.events subscriber when a scan is cancelled.
  const appEventEmitters = new Set<(event: EventOf<"app.events">) => void>();
  const emitAppEvent = (event: EventOf<"app.events">) => {
    for (const emit of appEventEmitters) emit(event);
  };
  return {
    procedures: {
      "app.state": async () => {
        const accounts = unwrapOrThrow(await deps.listAccounts.execute(workspaceId));
        return { status: "ready", hasConnectedAccount: accounts.length > 0 };
      },
      "device.name": () => deps.deviceName(),
      "accounts.list": async () =>
        unwrapOrThrow(await deps.listAccounts.execute(workspaceId)).map((account) => ({
          id: account.id,
          provider: PROVIDERS[account.provider],
          displayName: account.address,
        })),
      "overview.get": async (input) => {
        const overview = unwrapOrThrow(
          await deps.getOverview.execute(
            workspaceId,
            input.accountId === undefined ? undefined : unwrapOrThrow(AccountId(input.accountId)),
          ),
        );
        return { ...overview, cleanable: [...overview.cleanable] };
      },
      "review.get": async (input) => {
        const account =
          input.accountId === undefined ? undefined : unwrapOrThrow(AccountId(input.accountId));
        const overview = unwrapOrThrow(await deps.getOverview.execute(workspaceId, account));
        const accounts = unwrapOrThrow(await deps.listAccounts.execute(workspaceId));
        // This only knows whether an account is stored for the selection; there is no session probe
        // here, so say so plainly instead of claiming a connection is needed or missing (ADR 0002).
        const hasAccount = accounts.some((item) => account === undefined || item.id === account);
        return {
          toReview: overview.toReview,
          waiting: overview.waiting,
          deadlines: overview.deadlines,
          important: overview.important,
          cleanable: [...overview.cleanable],
          noAccount: !hasAccount,
        };
      },
      "mailbox.categories": async ({ accountIds }) => {
        return unwrapOrThrow(
          await deps.categories.execute(
            workspaceId,
            accountIds.map((id) => unwrapOrThrow(AccountId(id))),
          ),
        );
      },
      "scan.status": ({ accountIds }) =>
        deps.scans.live(accountIds.map((id) => unwrapOrThrow(AccountId(id)))),
      "digest.get": () => deps.digestStatus.execute(),
      "settings.get": async () => unwrapOrThrow(await deps.settings.get(workspaceId)),
      "settings.update": async (patch) => {
        unwrapOrThrow(await deps.settings.update(workspaceId, patch));
      },
      "scan.start": async ({ accountId }) => {
        const id = unwrapOrThrow(AccountId(accountId));
        return unwrapOrThrow(await deps.scans.start(id));
      },
      "scan.pause": ({ jobId }) => {
        unwrapOrThrow(deps.scans.pause(jobId));
      },
      "scan.resume": ({ jobId }) => {
        unwrapOrThrow(deps.scans.resume(jobId));
      },
      "scan.cancel": ({ jobId }) => {
        const live = deps.scans.live().find((job) => job.jobId === jobId);
        unwrapOrThrow(deps.scans.cancel(jobId));
        if (live !== undefined)
          emitAppEvent({ type: "ScanCancelled", accountId: live.accountId, jobId });
      },
    },
    subscriptions: {
      "scan.progress": ({ accountId }, emit) => {
        const stops = [
          deps.events.subscribe("ScanProgressed", (event) => {
            if (event.payload.accountId !== accountId) return;
            emit({
              accountId,
              phase: "classifying",
              processed: event.payload.processed,
              total: event.payload.total ?? null,
            });
          }),
          deps.events.subscribe("ScanCompleted", (event) => {
            if (event.payload.accountId !== accountId) return;
            const { processed } = event.payload;
            emit({ accountId, phase: "done", processed, total: processed });
          }),
        ];
        return () => {
          for (const stop of stops) stop();
        };
      },
      "app.events": (_input, emit) => {
        appEventEmitters.add(emit);
        const stops = [
          deps.events.subscribe("ActionApplied", (event) =>
            emit({ type: "ActionApplied", actionId: event.payload.actionId }),
          ),
          deps.events.subscribe("ActionFailed", (event) =>
            emit({
              type: "ActionFailed",
              actionId: event.payload.actionId,
              reason: failureReason(event.payload.errorCode),
            }),
          ),
          deps.events.subscribe("ScanCompleted", (event) =>
            emit({
              type: "ScanCompleted",
              accountId: event.payload.accountId,
              processed: event.payload.processed,
            }),
          ),
          deps.events.subscribe("ScanFailed", (event) =>
            emit({
              type: "ScanFailed",
              accountId: event.payload.accountId,
              reason: scanFailureReason(event.payload.errorCode),
            }),
          ),
          deps.events.subscribe("DigestReady", (event) =>
            emit({ type: "DigestReady", itemCount: event.payload.itemCount }),
          ),
        ];
        return () => {
          appEventEmitters.delete(emit);
          for (const stop of stops) stop();
        };
      },
    },
  };
}
