import type { Unsubscribe } from "@pochimail/kernel/common";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { FOCUSED_POLL_MS, VISIBLE_POLL_MS } from "@pochimail/mailbox/policies/poll-cadence";
import { createAdaptivePolling } from "@pochimail/pipeline/adaptive-polling";
import type { Timer } from "@pochimail/pipeline/event-batching";
import type { EventBus } from "@pochimail/pipeline/event-bus";
import type { PowerMonitor } from "@pochimail/pipeline/power-monitor";
import { createTimerScheduler } from "@pochimail/pipeline/timer-scheduler";
import type { WindowActivity } from "@pochimail/pipeline/window-activity";
import type { DomainEvent } from "../events.ts";
import type { WorkflowUnitOfWork } from "../ports/unit-of-work.ts";
import type { SyncRunner } from "../use-cases/sync-runner.ts";

export interface PollAccountsDeps {
  readonly uow: WorkflowUnitOfWork;
  readonly workspaceId: WorkspaceId;
  readonly syncs: SyncRunner;
  readonly timer: Timer;
  /** Reports a poll that threw; expected failures are `SyncResult` values. */
  readonly onError: (error: unknown) => void;
  readonly power: PowerMonitor;
  readonly activity: WindowActivity;
  readonly events: Pick<EventBus<DomainEvent>, "subscribe">;
}

/**
 * Polls every connected account on the adaptive cadence (ADR 0004): accounts already stored when the
 * worker starts are picked up at once, new ones as they connect, and removed ones are dropped. Each
 * account is its own watch, so one slow or failing account never delays another. Returns the stop.
 */
export function pollAccounts(deps: PollAccountsDeps): Unsubscribe {
  const polling = createAdaptivePolling({
    scheduler: createTimerScheduler(deps.timer),
    power: deps.power,
    activity: deps.activity,
    // Hidden windows wait for the Keep it tidy cadence, which the app does not supply yet.
    cadence: { focusedMs: FOCUSED_POLL_MS, visibleMs: VISIBLE_POLL_MS, hiddenMs: null },
    onError: deps.onError,
  });
  const stops = new Map<AccountId, Unsubscribe>();
  const watch = (accountId: AccountId) => {
    stops.set(
      accountId,
      polling.watch(accountId, async (signal) => {
        await deps.syncs.run(accountId, signal);
      }),
    );
  };
  const unwatch = (accountId: AccountId) => {
    stops.get(accountId)?.();
    stops.delete(accountId);
  };

  void deps.uow.reads.accounts.list(deps.workspaceId).then((listed) => {
    if (listed.ok) for (const account of listed.value) watch(account.id);
  });
  const offConnected = deps.events.subscribe("AccountConnected", (event) =>
    watch(event.payload.accountId),
  );
  const offState = deps.events.subscribe("AccountStateChanged", (event) => {
    if (event.payload.state === "disconnected") unwatch(event.payload.accountId);
  });
  return () => {
    offConnected();
    offState();
    polling.dispose();
    stops.clear();
  };
}
