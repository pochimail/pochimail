import type { Account } from "@pochimail/accounts/model/account";
import type { SecretStore } from "@pochimail/accounts/ports/secret-store";
import { ConnectAccount } from "@pochimail/accounts/use-cases/connect-account";
import { AiUnavailable } from "@pochimail/classification/errors";
import type { Category } from "@pochimail/classification/model/category";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { ClassifyBatch } from "@pochimail/classification/use-cases/classify-batch";
import type { Clock } from "@pochimail/kernel/clock";
import { AuthExpired, type ProviderError, RateLimited } from "@pochimail/kernel/errors";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import type { ThreadId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { MAX_SNIPPET_CHARS } from "@pochimail/mailbox/policies/sanitize-incoming";
import type { OutboxEntry } from "@pochimail/pipeline/outbox";
import type { DomainEvent } from "@pochimail/workflows/events";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import { RunIncrementalSync } from "@pochimail/workflows/use-cases/run-incremental-sync";
import { expect } from "vitest";
import { makeIncomingMessage, WS_A, WS_B } from "./fixtures.ts";
import type { UnitOfWork } from "./uow-types.ts";

/**
 * What the use-case suite needs from a mailbox + storage stack. The in-memory adapters (M1-09)
 * implement it today; SQLite and real providers (M2) implement it and run the suite unchanged.
 */
export interface SyncHarness {
  readonly uow: UnitOfWork;
  readonly secrets: SecretStore;
  readonly provider: MailProvider;
  readonly clock: Clock & { advance(ms: number): void };
  readonly ids: IdGenerator;
  /** Ground-truth labels by message id; the classifier answers from them. */
  readonly labels: Map<string, Category>;
  readonly classifier: Classifier;
  /** The next classifier call fails with `AiUnavailable`. */
  makeClassifierUnavailable(): void;
  /** Mail arriving at the provider; the next `sync` returns it. */
  deliver(...messages: IncomingMessage[]): void | Promise<void>;
  /** The body the provider would return for a message (it must never be stored). */
  setBody(messageId: string, body: string): void;
  /** The next provider `sync` call fails with this error. */
  failNextSync(error: ProviderError): void;
  /** Every committed row of every repository and the outbox, as plain data. */
  snapshot(): Promise<unknown>;
  committedOutbox(): Promise<readonly OutboxEntry[]>;
}

const live = () => new AbortController().signal;
const CREDENTIALS = "fake-refresh-token-do-not-store-in-rows";
function cases(h: SyncHarness) {
  return {
    connect: new ConnectAccount({ uow: h.uow, secrets: h.secrets, clock: h.clock, ids: h.ids }),
    sync: new RunIncrementalSync({ uow: h.uow, provider: h.provider, clock: h.clock }),
    classify: new ClassifyBatch({ uow: h.uow, classifier: h.classifier, clock: h.clock }),
  };
}

async function connected(h: SyncHarness): Promise<Account> {
  const outcome = unwrap(
    await cases(h).connect.execute(
      {
        workspaceId: WS_A,
        provider: "gmail",
        address: "Owner@Example.com",
        credentials: CREDENTIALS,
      },
      live(),
    ),
  );
  return outcome.account;
}

const mail = (account: Account, n: number, over: Partial<IncomingMessage> = {}) =>
  makeIncomingMessage(n, { accountId: account.id, workspaceId: account.workspaceId, ...over });

async function events(h: SyncHarness, type?: DomainEvent["type"]) {
  const entries = await h.committedOutbox();
  return entries.flatMap((e) =>
    e.kind === "event" && (type === undefined || e.event.type === type)
      ? [e.event as DomainEvent]
      : [],
  );
}

async function storedIds(h: SyncHarness, account: Account) {
  const page = unwrap(
    await h.uow.reads.messages.query(account.workspaceId, { accountId: account.id, limit: 1000 }),
  );
  return page.items.map((m) => m.id).sort();
}

export const syncChecks: readonly Check<SyncHarness>[] = [
  check(
    "connecting the same account twice keeps one account, one AccountConnected event and the latest credentials (guards duplicates on retry)",
    async (h) => {
      const { connect } = cases(h);
      const request = {
        workspaceId: WS_A,
        provider: "gmail",
        address: "owner@example.com",
        credentials: CREDENTIALS,
      } as const;
      const [first, second] = await Promise.all([
        connect.execute(request, live()),
        connect.execute({ ...request, address: "OWNER@example.com" }, live()),
      ]);
      const again = await connect.execute({ ...request, credentials: "newer-token" }, live());
      expect(unwrap(first).status).toBe("connected");
      expect(unwrap(second).status).toBe("already-connected");
      expect(unwrap(again).account.id).toBe(unwrap(first).account.id);
      expect(unwrap(await h.uow.reads.accounts.list(WS_A))).toHaveLength(1);
      expect(await events(h, "AccountConnected")).toHaveLength(1);
      const secret = unwrap(await h.secrets.get(`account/${WS_A}/${unwrap(first).account.id}`));
      expect(secret).toBe("newer-token");
    },
  ),
  check(
    "credentials stay in the secret store: no row or event holds them (guards a token leaking into storage)",
    async (h) => {
      await connected(h);
      expect(JSON.stringify(await h.snapshot())).not.toContain(CREDENTIALS);
    },
  ),
  check(
    "a second sync after new mail fetches only the delta (guards re-downloading the whole mailbox)",
    async (h) => {
      const account = await connected(h);
      const { sync } = cases(h);
      await h.deliver(...[1, 2, 3].map((n) => mail(account, n)));
      const first = unwrap(
        await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()),
      );
      await h.deliver(mail(account, 4), mail(account, 5));
      const second = unwrap(
        await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()),
      );
      expect([first.status, first.fetched]).toEqual(["completed", 3]);
      expect([second.status, second.fetched]).toEqual(["completed", 2]);
      expect(await storedIds(h, account)).toEqual([1, 2, 3, 4, 5].map((n) => `msg-${n}`));
    },
  ),
  check(
    "every synced message has its thread with matching counts, and replaying a batch adds no duplicate (guards orphan messages and double-counted threads)",
    async (h) => {
      const account = await connected(h);
      const { sync } = cases(h);
      const shared = { threadId: "thr-shared" as ThreadId };
      const batch = [mail(account, 1, shared), mail(account, 2), mail(account, 3, shared)];
      await h.deliver(...batch);
      unwrap(await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()));
      // Replay the same batch from the start (cursor lost): nothing may double up.
      await h.deliver(...batch);
      unwrap(await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()));

      const thread = unwrap(await h.uow.reads.threads.get(WS_A, "thr-shared" as ThreadId));
      expect(thread.messageIds).toEqual(["msg-1", "msg-3"]);
      expect(thread.lastMessageAt).toBe(mail(account, 3).receivedAt);
      expect(unwrap(await h.uow.reads.threads.get(WS_A, "thr-2" as ThreadId)).messageIds).toEqual([
        "msg-2",
      ]);
      const rows = (await h.snapshot()) as { threads: unknown[] };
      expect(rows.threads).toHaveLength(2);
    },
  ),
  check(
    "a sync interrupted and resumed ends in the same state as an uninterrupted run (guards gaps or repeats after a pause)",
    async (h) => {
      const account = await connected(h);
      await h.deliver(...[1, 2, 3, 4, 5].map((n) => mail(account, n)));
      const stop = new AbortController();
      let calls = 0;
      const interrupting: MailProvider = {
        capabilities: h.provider.capabilities,
        applyCommands: (c, s) => h.provider.applyCommands(c, s),
        fetchBody: (id, s) => h.provider.fetchBody(id, s),
        sync: async (cursor, signal) => {
          calls += 1;
          const batch = await h.provider.sync(cursor, signal);
          if (calls === 1) stop.abort();
          return batch;
        },
      };
      const interrupted = new RunIncrementalSync({
        uow: h.uow,
        provider: interrupting,
        clock: h.clock,
      });
      const paused = unwrap(
        await interrupted.execute({ workspaceId: WS_A, accountId: account.id }, stop.signal),
      );
      expect(paused.status).toBe("paused");
      expect(await storedIds(h, account)).not.toHaveLength(5);

      const resumed = unwrap(
        await cases(h).sync.execute({ workspaceId: WS_A, accountId: account.id }, live()),
      );
      expect(resumed.status).toBe("completed");
      expect(await storedIds(h, account)).toEqual([1, 2, 3, 4, 5].map((n) => `msg-${n}`));
      expect(paused.fetched + resumed.fetched).toBe(5);
    },
  ),
  check(
    "RateLimited pauses the account and answers the provider's retry time, queues no job, and keeps committed batches (guards a hammered provider, an unconsumed job and lost progress)",
    async (h) => {
      const account = await connected(h);
      const { sync } = cases(h);
      await h.deliver(...[1, 2, 3].map((n) => mail(account, n)));
      h.failNextSync(new RateLimited({ retryAfterMs: 30_000 }));
      const startedAt = h.clock.now().getTime();
      const limited = unwrap(
        await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()),
      );

      expect(limited.status).toBe("rate-limited");
      const resumeAt = new Date(startedAt + 30_000).toISOString();
      expect(limited).toMatchObject({ resumeAt });
      const states = (await events(h, "AccountStateChanged")).map((e) => e.payload);
      expect(states.at(-1)).toMatchObject({ accountId: account.id, state: "paused" });
      const jobs = (await h.committedOutbox()).flatMap((e) => (e.kind === "job" ? [e.job] : []));
      expect(jobs).toHaveLength(0);

      h.clock.advance(30_000);
      const retried = unwrap(
        await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()),
      );
      expect(retried.status).toBe("completed");
      expect((await events(h, "AccountStateChanged")).at(-1)?.payload).toMatchObject({
        state: "connected",
      });
      expect(await storedIds(h, account)).toHaveLength(3);
    },
  ),
  check(
    "expired credentials put the account in needs_reauth instead of retrying (guards a silent retry loop on a dead token)",
    async (h) => {
      const account = await connected(h);
      h.failNextSync(new AuthExpired());
      const outcome = unwrap(
        await cases(h).sync.execute({ workspaceId: WS_A, accountId: account.id }, live()),
      );
      expect(outcome.status).toBe("needs-reauth");
      expect((await events(h, "AccountStateChanged")).at(-1)?.payload).toMatchObject({
        state: "needs_reauth",
      });
    },
  ),
  check(
    "a message of another workspace returned by a provider is never stored (guards cross-workspace leakage)",
    async (h) => {
      const account = await connected(h);
      await h.deliver(mail(account, 1), mail(account, 2, { workspaceId: WS_B }));
      unwrap(await cases(h).sync.execute({ workspaceId: WS_A, accountId: account.id }, live()));
      expect(await storedIds(h, account)).toEqual(["msg-1"]);
    },
  ),
  check(
    "classifying records the ground-truth category and one event per message, and an unavailable classifier changes nothing (guards partial writes)",
    async (h) => {
      const account = await connected(h);
      const { sync, classify } = cases(h);
      await h.deliver(...[1, 2, 3].map((n) => mail(account, n)));
      h.labels.set("msg-1", "newsletters");
      h.labels.set("msg-2", "records");
      unwrap(await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()));
      const ids = [1, 2, 3].map((n) => unwrap(MessageIdOf(`msg-${n}`)));

      h.makeClassifierUnavailable();
      const failed = await classify.execute({ workspaceId: WS_A, messageIds: ids }, live());
      expect(failed.ok ? null : failed.error).toBeInstanceOf(AiUnavailable);
      expect(await events(h, "MessageClassified")).toHaveLength(0);

      const report = unwrap(await classify.execute({ workspaceId: WS_A, messageIds: ids }, live()));
      expect(report.classified).toBe(2);
      expect(report.unclassified).toEqual(["msg-3"]);
      const stored = unwrap(await h.uow.reads.messages.get(WS_A, ids[0] as (typeof ids)[number]));
      expect(stored.category).toBe("newsletters");
      expect(await events(h, "MessageClassified")).toHaveLength(2);
    },
  ),
  check(
    "a synced and classified message leaves no body in any repository (follows proposed D11)",
    async (h) => {
      const account = await connected(h);
      const { sync, classify } = cases(h);
      const BODY = "SECRET-BODY-TEXT-0001";
      const ATTACHMENT = "SECRET-ATTACHMENT-0002";
      // A careless adapter hands over the whole body as the snippet, plus fields we never model.
      const bloated = {
        ...mail(account, 1, { snippet: `${"x".repeat(MAX_SNIPPET_CHARS)}${BODY}` }),
        body: BODY,
        attachments: [{ filename: ATTACHMENT, content: ATTACHMENT }],
      } as IncomingMessage;
      await h.deliver(bloated);
      h.setBody("msg-1", `${BODY} full text`);
      h.labels.set("msg-1", "records");

      unwrap(await sync.execute({ workspaceId: WS_A, accountId: account.id }, live()));
      unwrap(
        await classify.execute(
          { workspaceId: WS_A, messageIds: [unwrap(MessageIdOf("msg-1"))] },
          live(),
        ),
      );

      const everything = JSON.stringify(await h.snapshot());
      expect(everything).not.toContain(BODY);
      expect(everything).not.toContain(ATTACHMENT);
      const stored = unwrap(await h.uow.reads.messages.get(WS_A, unwrap(MessageIdOf("msg-1"))));
      expect(stored.snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
      expect(Object.keys(stored)).not.toContain("body");
    },
  ),
];

import { MessageId as MessageIdOf } from "@pochimail/kernel/ids";

/** Registers the use-case suite over any stack; `make` returns a fresh, empty harness. */
export function runSyncContract(make: () => SyncHarness | Promise<SyncHarness>): void {
  registerContract("Sync and classify use cases", syncChecks, make);
}
