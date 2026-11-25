// Guards: topics that drift between scans or duplicate, and a model answer written to storage unchecked.
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import type { MessageId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { AiUnavailable } from "./errors.ts";
import type { TopicDiscoverer } from "./ports/topic-discoverer.ts";
import { createFakeTopicDiscoverer } from "./testing/fake-ai.ts";
import { createInMemoryClassification } from "./testing/in-memory-classification.ts";
import { ACCOUNT_1, live, WS_A } from "./testing/samples.ts";
import { CountTopics } from "./use-cases/count-topics.ts";
import { DiscoverTopics } from "./use-cases/discover-topics.ts";

const SHOP = { from: "orders@shop.example.com" };
const CLUB = { from: "news@club.example.com" };
const ids = (...n: number[]) => n.map((x) => `msg-${x}` as MessageId);

async function mailbox() {
  const c = createInMemoryClassification();
  await c.seed({
    1: { message: SHOP },
    2: { message: SHOP },
    3: { message: CLUB },
    4: { message: CLUB },
    5: { message: { from: "friend@alone.example.com" } },
  });
  let n = 0;
  const generator: IdGenerator = { next: (prefix) => `${prefix}_${++n}` };
  const discover = (discoverer: TopicDiscoverer = createFakeTopicDiscoverer()) =>
    new DiscoverTopics({ uow: c.uow, discoverer, ids: generator }).execute(
      { workspaceId: WS_A, messageIds: ids(1, 2, 3, 4, 5) },
      live(),
    );
  return { c, discover };
}

describe("DiscoverTopics", () => {
  it("discovery twice on the same mailbox gives the same topics and files, with no duplicate", async () => {
    const { c, discover } = await mailbox();
    const first = unwrap(await discover());
    const filed = c.topicAssignments();
    const second = unwrap(await discover());
    expect(first.topics.map((t) => t.name)).toEqual(["Club", "Shop"]);
    expect(second).toEqual(first);
    expect(c.topicAssignments()).toEqual(filed);
    expect(Object.keys(filed)).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"]);
    expect(unwrap(await c.uow.reads.topics.list(WS_A))).toHaveLength(2);
  });

  it("names are matched without case or extra spaces, and invalid names or foreign ids are dropped (guards unchecked model output)", async () => {
    const { c, discover } = await mailbox();
    unwrap(await discover());
    const filed = c.topicAssignments();
    const sloppy: TopicDiscoverer = {
      discover: async () =>
        ok([
          { name: "  SHOP  ", messageIds: ids(1, 99) },
          { name: "   ", messageIds: ids(3) },
        ]),
    };
    const report = unwrap(await discover(sloppy));
    expect(report.topics.map((t) => t.name)).toEqual(["Club", "Shop"]);
    expect(c.topicAssignments()).toEqual(filed);
  });

  it("a message the model did not mention keeps its topics, and one it mentions is re-filed (guards a partial answer wiping the mailbox)", async () => {
    const { c, discover } = await mailbox();
    unwrap(await discover());
    const filed = c.topicAssignments();
    const partial: TopicDiscoverer = {
      discover: async () => ok([{ name: "Club", messageIds: ids(1) }]),
    };
    const report = unwrap(await discover(partial));
    const after = c.topicAssignments();
    expect(after["msg-1"]).toEqual(after["msg-3"]);
    expect(after["msg-1"]).not.toEqual(filed["msg-1"]);
    expect(after["msg-2"]).toEqual(filed["msg-2"]);
    expect(report.assigned).toBe(1);
  });

  it("names over 60 characters are dropped and topics stop at 50 (guards a model flooding the sidebar)", async () => {
    const { c, discover } = await mailbox();
    const flood: TopicDiscoverer = {
      discover: async () =>
        ok([
          { name: "x".repeat(61), messageIds: ids(1) },
          { name: "y".repeat(60), messageIds: ids(2) },
          ...Array.from({ length: 80 }, (_, i) => ({ name: `Topic ${i}`, messageIds: ids(3) })),
        ]),
    };
    const report = unwrap(await discover(flood));
    expect(report.topics).toHaveLength(50);
    expect(report.topics.some((t) => t.name.length > 60)).toBe(false);
    expect(report.topics.some((t) => t.name === "y".repeat(60))).toBe(true);
    expect(c.topicAssignments()["msg-1"]).toBeUndefined();
  });

  it("an unavailable model fails with AiUnavailable and files nothing (guards a half-written scan)", async () => {
    const { c, discover } = await mailbox();
    const discoverer = createFakeTopicDiscoverer();
    discoverer.makeUnavailable();
    const r = await discover(discoverer);
    expect(!r.ok && r.error).toBeInstanceOf(AiUnavailable);
    expect(c.topicAssignments()).toEqual({});
    expect(unwrap(await c.uow.reads.topics.list(WS_A))).toEqual([]);
  });

  it("the sidebar counts list only topics that hold email, by name (guards an empty topic shown)", async () => {
    const { c, discover } = await mailbox();
    unwrap(await discover());
    const empty = { schemaVersion: 1 as const, id: "top_empty", workspaceId: WS_A, name: "Alpha" };
    unwrap(await c.uow.run(async (tx) => tx.repositories.topics.save(empty as never), live()));
    const counts = unwrap(await new CountTopics({ uow: c.uow }).execute(WS_A, [ACCOUNT_1]));
    expect(counts.map((t) => [t.name, t.count])).toEqual([
      ["Club", 2],
      ["Shop", 2],
    ]);
    expect(unwrap(await new CountTopics({ uow: c.uow }).execute(WS_A, []))).toEqual([]);
  });
});
