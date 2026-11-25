import type { Account } from "@pochimail/accounts/model/account";
import { ListAccounts } from "@pochimail/accounts/use-cases/list-accounts";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { CountTypes } from "@pochimail/classification/use-cases/count-types";
import { GetDigestStatus } from "@pochimail/cleanup/use-cases/get-digest-status";
import { GetOverview } from "@pochimail/cleanup/use-cases/get-overview";
import { RecordDigestReady } from "@pochimail/cleanup/use-cases/record-digest-ready";
import type { Clock } from "@pochimail/kernel/clock";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { Logger } from "@pochimail/logger/logger";
import type { Timer } from "@pochimail/pipeline/event-batching";
import { createInMemoryEventBus } from "@pochimail/pipeline/in-memory-event-bus";
import type { JobQueue } from "@pochimail/pipeline/job-queue";
import type { OutboxStore } from "@pochimail/pipeline/outbox";
import { createOutboxRelay } from "@pochimail/pipeline/outbox-relay";
import { parseDomainEvent } from "@pochimail/workflows/events";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import type { WorkflowUnitOfWork as UnitOfWork } from "@pochimail/workflows/ports/unit-of-work";
import { RunScan } from "@pochimail/workflows/use-cases/run-scan";
import { ScanRunner } from "@pochimail/workflows/use-cases/scan-runner";
import type { Handlers } from "../shared/ipc/server.ts";
import type { DeviceName } from "../shared/platform-port.ts";
import type { SettingsStore } from "../shared/settings.ts";
import { createDigestTally } from "./digest-tally.ts";
import { createHandlers } from "./handlers.ts";
import { ManageSettings } from "./manage-settings.ts";
import { resolvePendingActions } from "./pending-actions.ts";

/**
 * Everything the worker needs from the outside, as ports. The fixture bundle (dev/E2E) and M2's SQLite and real
 * provider adapters are two implementations of this one shape; nothing in `createWorkerApp` or the handlers names either.
 */
export interface WorkerAdapters {
  readonly workspaceId: WorkspaceId;
  readonly clock: Clock;
  readonly random: () => number;
  readonly timer: Timer;
  readonly logger: Logger;
  /** A new, unique id for a scan job. */
  readonly newJobId: () => string;
  readonly uow: UnitOfWork;
  readonly outboxStore: OutboxStore;
  readonly queue: JobQueue;
  readonly settings: SettingsStore;
  readonly classifier: Classifier;
  /** The mail provider of one connected account. */
  readonly providerFor: (account: Account) => MailProvider;
  readonly deviceName: () => DeviceName;
}

export interface WorkerApp {
  readonly handlers: Handlers;
  /** Resolves once every running scan has stopped (orderly shutdown, tests). */
  idle(): Promise<void>;
}

/** The worker's composition root: domain use cases and workflows wired to the adapters it is given, behind the typed IPC handlers. */
export function createWorkerApp(adapters: WorkerAdapters): WorkerApp {
  const { uow, workspaceId, clock } = adapters;
  const bus = createInMemoryEventBus({
    parse: parseDomainEvent,
    logger: adapters.logger,
    timer: adapters.timer,
  });
  const relay = createOutboxRelay({ store: adapters.outboxStore, bus, queue: adapters.queue });

  // One drain at a time, so a row is never delivered twice by two overlapping drains.
  let draining: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    draining = draining.then(async () => {
      const drained = await relay.drain();
      if (!drained.ok) adapters.logger.error("event delivery failed", { code: drained.error.code });
    });
    return draining;
  };
  void flush(); // events committed before a restart still go out
  // Settles actions a crash left pending; its events go out with the next flush.
  const recovery = resolvePendingActions(adapters).then(flush);

  const tally = createDigestTally();
  const recordDigest = new RecordDigestReady({ tally });
  bus.subscribe("DigestReady", (event) => recordDigest.execute(event));

  const scans = new ScanRunner({
    uow,
    workspaceId,
    newJobId: adapters.newJobId,
    scanFor: (account) =>
      new RunScan({
        uow,
        provider: adapters.providerFor(account),
        classifier: adapters.classifier,
        clock,
        queue: adapters.queue,
        random: adapters.random,
        workspaceId,
        accountId: account.id,
        flush,
      }),
  });

  const handlers = createHandlers({
    workspaceId,
    listAccounts: new ListAccounts({ uow }),
    getOverview: new GetOverview({ uow, clock }),
    categories: new CountTypes({ uow }),
    digestStatus: new GetDigestStatus({ tally }),
    settings: new ManageSettings({ store: adapters.settings }),
    scans,
    events: bus,
    deviceName: adapters.deviceName,
  });
  return {
    handlers,
    idle: async () => {
      await recovery;
      await scans.idle();
    },
  };
}
