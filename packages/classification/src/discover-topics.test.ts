// Guards: topics that drift between scans or duplicate, and a model answer written to storage unchecked.
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import type { MessageId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { AiUnavailable } from "./errors.ts";
import type { TopicDiscoverer } from "./ports/topic-discoverer.ts";
import { createFakeTopicDiscoverer } from "./testing/fake-ai.ts";
import { createInMemoryClassification } from "./testing/in-memory-classification.ts";
import { live, WS_A } from "./testing/samples.ts";
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
    const sloppy: TopicDiscoverer = {
      discover: async () =>
        ok([
          { name: "  SHOP  ", messageIds: ids(1, 99) },
          { name: "   ", messageIds: ids(3) },
        ]),
    };
    const report = unwrap(await discover(sloppy));
    expect(report.topics.map((t) => t.name)).toEqual(["Club", "Shop"]);
    expect(Object.keys(c.topicAssignments())).toEqual(["msg-1"]);
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
});
