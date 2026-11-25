import type { Account } from "@pochimail/accounts/model/account";
import { type ActionLog, actionLogSchema, inverseOf } from "@pochimail/actions/model/action";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import type { Clock } from "@pochimail/kernel/clock";
import { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import type { Timer } from "@pochimail/pipeline/event-batching";
import { createFixtureMailProvider } from "@pochimail/testing/fixture-mailbox/fixture-mail-provider";
import {
  FIXTURE_NOW,
  type FixtureAccount,
  type GeneratedMailbox,
  generateMailbox,
} from "@pochimail/testing/fixture-mailbox/generator";
import {
  type FixtureMessage,
  readMailbox,
} from "@pochimail/testing/fixture-mailbox/mailbox-reader";
import { createInMemoryJobQueue } from "@pochimail/testing/in-memory-job-queue";
import { createInMemoryUnitOfWork } from "@pochimail/testing/in-memory-store";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import { DEMO_SEED, type DemoScale } from "../shared/demo.ts";
import type { DeviceName } from "../shared/platform-port.ts";
import type { WorkerAdapters } from "./app.ts";
import { createInMemorySettingsStore } from "./in-memory-settings-store.ts";

export interface FixtureAdapterOptions {
  readonly scale: DemoScale;
  readonly timer: Timer;
  readonly logger: Logger;
  readonly deviceName: () => DeviceName;
  /** Answers classification; in the app this is the model host link. */
  readonly classifier: Classifier;
  readonly newJobId: () => string;
  /** Messages per provider page. Default 100. */
  readonly pageSize?: number;
  /** Each page takes this long to arrive, so a scan stays in progress (E2E). Default none. */
  readonly pageDelayMs?: number;
}

/** How many of the fixture's own clean-up candidates the demo history already carried out (#114). */
export const DEMO_HISTORY_CAPS = { archived: 120, trashed: 40, unsubscribed: 30 } as const;

interface DemoPick {
  readonly kind: "archive" | "trash" | "unsubscribe";
  readonly message: FixtureMessage["message"];
}

/**
 * The demo's past actions, picked deterministically from the first account's labels in file order
 * (oldest first): the oldest documents to Trash, then the fixture's own archive and unsubscribe
 * candidates. Only the first account carries history, so scanning one account still stores exactly
 * its mailbox.
 */
function pickDemoHistory(mailbox: GeneratedMailbox, account: FixtureAccount): DemoPick[] {
  const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l]));
  const picked: DemoPick[] = [];
  const counts = { archive: 0, trash: 0, unsubscribe: 0 };
  const read = readMailbox(account.mbox, {
    accountId: account.id,
    workspaceId: mailbox.workspaceId,
  });
  for (const { message } of read) {
    const label = labels.get(message.id);
    if (label?.signals.includes("has-document") && counts.trash < DEMO_HISTORY_CAPS.trashed) {
      counts.trash += 1;
      picked.push({ kind: "trash", message });
    } else if (
      label?.expectedSuggestion === "archive" &&
      counts.archive < DEMO_HISTORY_CAPS.archived
    ) {
      counts.archive += 1;
      picked.push({ kind: "archive", message });
    } else if (
      label?.expectedSuggestion === "unsubscribe" &&
      counts.unsubscribe < DEMO_HISTORY_CAPS.unsubscribed
    ) {
      counts.unsubscribe += 1;
      picked.push({ kind: "unsubscribe", message });
    }
  }
  return picked;
}

/**
 * One batch entry per reversible kind, one entry per unsubscribe sender (the figure counts
 * entries). The log marks stored rows, so the acted-on messages are stored before these entries
 * are appended; the scan's later upsert keeps the markers.
 */
function demoHistoryEntries(workspaceId: string, picked: readonly DemoPick[]): ActionLog[] {
  // One fixed moment before "today" inside the fixture: the history is past, and deterministic.
  const at = new Date(FIXTURE_NOW - 86_400_000).toISOString();
  const entries: ActionLog[] = [];
  for (const kind of ["trash", "archive"] as const) {
    const messageIds = picked.filter((p) => p.kind === kind).map((p) => p.message.id);
    if (messageIds.length === 0) continue;
    const command = { kind, messageIds };
    entries.push(
      actionLogSchema.parse({
        schemaVersion: 1,
        id: `log-demo-${kind}`,
        workspaceId,
        actionId: `act-demo-${kind}`,
        idempotencyKey: `demo-${kind}`,
        batchId: `demo-${kind}`,
        outcome: "applied",
        command,
        inverse: inverseOf(command),
        irreversible: false,
        at,
      }),
    );
  }
  // The reason is ApplyAction's.
  let n = 0;
  for (const p of picked) {
    if (p.kind !== "unsubscribe") continue;
    n += 1;
    entries.push(
      actionLogSchema.parse({
        schemaVersion: 1,
        id: `log-demo-unsubscribe-${n}`,
        workspaceId,
        actionId: `act-demo-unsubscribe-${n}`,
        idempotencyKey: `demo-unsubscribe-${n}`,
        outcome: "applied",
        command: { kind: "unsubscribe", messageIds: [p.message.id] },
        inverse: null,
        irreversible: true,
        irreversibleReason: "An unsubscribe request cannot be recalled",
        at,
      }),
    );
  }
  return entries;
}

/**
 * The fixture bundle (dev/E2E only): the mock dataset of brief §6 as two accounts, an in-memory store and queue, no
 * network and no real account. M2's SQLite and real provider adapters replace this bundle without touching the handlers.
 */
export async function createFixtureAdapters(
  options: FixtureAdapterOptions,
): Promise<WorkerAdapters> {
  const mailbox = generateMailbox({ seed: DEMO_SEED, scale: options.scale });
  // "Today" inside the fixture is fixed (ages and signals depend on it) but keeps moving, so retry back-off still elapses.
  const startedAt = Date.now();
  const clock: Clock = { now: () => new Date(FIXTURE_NOW + (Date.now() - startedAt)) };
  const workspaceId = unwrap(WorkspaceId(mailbox.workspaceId));
  const store = createInMemoryUnitOfWork();
  const accounts: Account[] = mailbox.accounts.map((account) => ({
    schemaVersion: 1,
    id: unwrap(AccountId(account.id)),
    workspaceId,
    provider: account.provider,
    address: account.address,
    connectedAt: clock.now().toISOString(),
    grantedScopes: [],
  }));
  const first = mailbox.accounts[0];
  const picked = first === undefined ? [] : pickDemoHistory(mailbox, first);
  const seeded = await store.uow.run(async (tx) => {
    for (const account of accounts) {
      const saved = await tx.repositories.accounts.save(account);
      if (!saved.ok) return saved;
    }
    const stored = await tx.repositories.messages.upsertMany(picked.map((p) => p.message));
    if (!stored.ok) return stored;
    for (const entry of demoHistoryEntries(mailbox.workspaceId, picked)) {
      const logged = await tx.repositories.actionLog.append(entry);
      if (!logged.ok) return logged;
    }
    return { ok: true as const, value: undefined };
  });
  if (!seeded.ok) throw seeded.error;

  const providers = new Map(
    mailbox.accounts.map((account) => {
      const provider = createFixtureMailProvider({
        mbox: account.mbox,
        accountId: account.id,
        workspaceId: mailbox.workspaceId,
        pageSize: options.pageSize ?? 100,
      });
      const delay = options.pageDelayMs;
      if (delay === undefined) return [account.id, provider] as const;
      const paced: MailProvider = {
        ...provider,
        sync: async (cursor, signal) => {
          await new Promise<void>((resolve) => options.timer.set(resolve, delay));
          return provider.sync(cursor, signal);
        },
      };
      return [account.id, paced] as const;
    }),
  );
  return {
    workspaceId,
    clock: clock,
    random: Math.random,
    timer: options.timer,
    logger: options.logger,
    newJobId: options.newJobId,
    uow: store.uow,
    outboxStore: store.outboxStore,
    queue: createInMemoryJobQueue(clock),
    settings: createInMemorySettingsStore(),
    classifier: options.classifier,
    providerFor: (account) => {
      const provider = providers.get(account.id);
      if (provider === undefined) throw new Error("no fixture for this account");
      return provider;
    },
    deviceName: options.deviceName,
  };
}
