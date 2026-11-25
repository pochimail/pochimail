import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";
import { describe, expect, it } from "vitest";
import { mailProviderContract } from "../mail-provider-contract.ts";
import { createFixtureMailProvider } from "./fixture-mail-provider.ts";
import { generateMailbox, MOCK_DATASET } from "./generator.ts";
import { labelsFileSchema } from "./labels.ts";
import { readMailbox } from "./mailbox-reader.ts";

const SEED = 20261117;
const live = () => new AbortController().signal;
const small = generateMailbox({ seed: SEED, scale: "small" });
const [gmail] = small.accounts;
if (!gmail) throw new Error("generator returned no account");
const firstOf = <T>(items: readonly T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
};

async function syncAll(
  provider: ReturnType<typeof createFixtureMailProvider>,
  from = null as never,
) {
  const messages = [];
  let restarted = false;
  let cursor = from as Parameters<typeof provider.sync>[0];
  for (;;) {
    const result = await provider.sync(cursor, live());
    if (!result.ok) throw result.error;
    messages.push(...result.value.messages);
    cursor = result.value.nextCursor;
    restarted ||= result.value.restarted;
    if (!result.value.hasMore) return { messages, cursor, restarted };
  }
}

describe("generateMailbox", () => {
  it("same seed gives byte-identical mbox and labels, a different seed does not (guards a clock or Math.random leak)", () => {
    const again = generateMailbox({ seed: SEED, scale: "small" });
    expect(again.accounts.map((a) => a.mbox)).toEqual(small.accounts.map((a) => a.mbox));
    expect(JSON.stringify(again.labels)).toBe(JSON.stringify(small.labels));
    const other = generateMailbox({ seed: SEED + 1, scale: "small" });
    expect(other.accounts[0]?.mbox).not.toBe(gmail.mbox);
  });

  it("the full scale reproduces the brief §6 mock dataset numbers exactly (guards drifting proportions)", () => {
    const { labels, accounts } = generateMailbox({ seed: SEED, scale: "full" });
    expect(accounts).toHaveLength(2);
    expect(labels.totals.messages).toBe(MOCK_DATASET.totalMessages);
    expect(labels.totals.byCategory).toEqual(MOCK_DATASET.categories);
    expect(labels.totals.documents).toBe(MOCK_DATASET.documents);
    const count = (kind: string) =>
      labels.messages.filter((m) => m.signals.includes(kind as never)).length;
    // An unanswered recent message from an important person also waits on the owner.
    expect(count("needs-reply")).toBe(MOCK_DATASET.peopleWaiting + MOCK_DATASET.newFromImportant);
    expect(count("time-sensitive")).toBe(MOCK_DATASET.deadlinesThisWeek);
    expect(count("important-sender")).toBe(MOCK_DATASET.newFromImportant);
  }, 60_000);

  it("the small scale keeps every type and keeps the type shares within 1 point (guards a skewed demo mailbox)", () => {
    const { totals } = small.labels;
    for (const category of EMAIL_TYPES) {
      const share = totals.byCategory[category] / totals.messages;
      expect(
        Math.abs(share - MOCK_DATASET.categories[category] / MOCK_DATASET.totalMessages),
      ).toBeLessThan(0.01);
    }
  });

  it("every message in the mbox has exactly one label and the labels file validates (guards unlabeled ground truth)", () => {
    expect(labelsFileSchema.safeParse(small.labels).success).toBe(true);
    const ids = small.accounts.flatMap((a) =>
      readMailbox(a.mbox, { accountId: a.id, workspaceId: small.workspaceId }).map(
        (m) => m.message.id,
      ),
    );
    expect(ids.length).toBe(new Set(ids).size);
    expect([...ids].sort()).toEqual(small.labels.messages.map((m) => m.messageId).sort());
  });

  it("French, Japanese, long threads and attachments survive the mbox round trip (guards encoding and >From corruption)", () => {
    const labels = new Map(small.labels.messages.map((l) => [l.messageId, l]));
    const read = small.accounts.flatMap((a) =>
      readMailbox(a.mbox, { accountId: a.id, workspaceId: small.workspaceId }),
    );
    const ja = read.find((m) => labels.get(m.message.id)?.language === "ja");
    const fr = read.find(
      (m) =>
        labels.get(m.message.id)?.language === "fr" && /[éèàç]/.test(m.message.subject + m.body),
    );
    expect(ja?.body).toMatch(/[぀-ヿ一-鿿]/);
    expect(fr).toBeDefined();
    // The newsletter template has a body line starting with "From ": it must not split the message.
    expect(read.some((m) => m.body.split("\n").some((l) => l.startsWith("From ")))).toBe(true);
    const perThread = new Map<string, number>();
    for (const l of small.labels.messages)
      perThread.set(l.threadId, (perThread.get(l.threadId) ?? 0) + 1);
    const longest = Math.max(...perThread.values());
    expect(longest).toBeGreaterThanOrEqual(8);
    expect(read.filter((m) => m.attachments.length > 0)).toHaveLength(
      small.labels.totals.documents,
    );
  });

  it("the small fixture generates in a few seconds (guards a slow CI demo fixture)", () => {
    const started = performance.now();
    generateMailbox({ seed: 7, scale: "small" });
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("personal and transactional mail never gets a clean-up suggestion (guards proposing to touch people or receipts, brief §2)", () => {
    for (const label of small.labels.messages)
      if (["personal", "transactional"].includes(label.category))
        expect(label.expectedSuggestion).toBeNull();
  });
});

describe("FixtureMailProvider", () => {
  mailProviderContract(() => {
    const provider = createFixtureMailProvider({
      accountId: "acc-1",
      workspaceId: "ws-a",
      pageSize: 2,
    });
    return { provider, deliver: (...messages) => provider.deliver(...messages) };
  });

  const make = (pageSize = 50) =>
    createFixtureMailProvider({
      mbox: gmail.mbox,
      accountId: gmail.id,
      workspaceId: small.workspaceId,
      pageSize,
    });
  const expected = small.labels.messages.filter((m) => m.accountId === gmail.id).length;

  it("a backfill returns the whole mbox oldest first across pages (guards a lost page)", async () => {
    const { messages } = await syncAll(make(40));
    expect(messages).toHaveLength(expected);
    const times = messages.map((m) => m.receivedAt);
    expect([...times].sort()).toEqual(times);
  });

  it("archiving shows up in the next delta and in the message state, and unarchive reverses it (guards effects lost or delta that misses changes)", async () => {
    const provider = make();
    const first = await syncAll(provider);
    const target = firstOf(first.messages).id;
    const applied = await provider.applyCommands(
      [
        { kind: "archive", messageIds: [target] },
        { kind: "apply-label", messageIds: [target], label: "demo" },
      ],
      live(),
    );
    expect(applied.ok).toBe(true);
    expect(provider.stateOf(target)).toMatchObject({ archived: true, labels: ["demo"] });
    const delta = await syncAll(provider, first.cursor as never);
    expect(delta.messages.map((m) => m.id)).toEqual([target]);
    await provider.applyCommands([{ kind: "unarchive", messageIds: [target] }], live());
    expect(provider.stateOf(target)?.archived).toBe(false);
  });

  it("an expired cursor restarts with a full walk and says so (guards silently missing mail after history loss)", async () => {
    const provider = make();
    const first = await syncAll(provider);
    provider.expireCursors();
    const again = await syncAll(provider, first.cursor as never);
    expect(again.restarted).toBe(true);
    expect(again.messages).toHaveLength(expected);
  });

  it("fetchBody decodes the real body and a vanished message is a Conflict (guards raw encoded bodies)", async () => {
    const provider = make();
    const { messages } = await syncAll(provider);
    const body = await provider.fetchBody(firstOf(messages).id as never, live());
    expect(
      body.ok && !body.value.includes("=?") && !/^[A-Za-z0-9+/=]{60,}$/m.test(body.value),
    ).toBe(true);
    const missing = await provider.fetchBody("nope" as never, live());
    expect(!missing.ok && missing.error.code).toBe("provider.conflict");
  });
});
