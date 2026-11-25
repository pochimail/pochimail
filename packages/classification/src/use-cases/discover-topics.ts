import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { Cancelled, NotFound, StorageError } from "@pochimail/kernel/errors";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import type { MessageId, TopicId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { topicIdSchema } from "@pochimail/kernel/schemas";
import type { ClassifiableMessage } from "../model/message-facts.ts";
import { TOPICS_MAX, type Topic, topicSchema } from "../model/topic.ts";
import type { AiError } from "../ports/classifier.ts";
import type { TopicDiscoverer, TopicProposal } from "../ports/topic-discoverer.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";

export interface DiscoverTopicsDeps {
  readonly uow: ClassificationUnitOfWork;
  readonly discoverer: TopicDiscoverer;
  readonly ids: IdGenerator;
}

export interface DiscoverTopicsRequest {
  readonly workspaceId: WorkspaceId;
  readonly messageIds: readonly MessageId[];
}

export interface DiscoverTopicsReport {
  /** Every topic of the workspace after this run, by name. */
  readonly topics: readonly Topic[];
  /** Messages that now carry at least one topic. */
  readonly assigned: number;
}

export type DiscoverTopicsError = AiError | StorageError | NotFound | Cancelled;

/** Two names are the same topic when they only differ in case, accents' composition or spacing. */
const keyOf = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Finds the topics of stored messages and files each message under them. A topic is stable once
 * created: a name that matches an existing topic reuses its id and its name, so running twice on
 * the same mail creates nothing new. Output of the model is untrusted: names are validated
 * (at most `TOPIC_NAME_MAX` characters), at most `TOPICS_MAX` topics exist per workspace,
 * ids outside the batch are ignored, and only messages named in a valid proposal are re-filed. Reads only headers and metadata (ADR 0014).
 */
export class DiscoverTopics {
  constructor(private readonly deps: DiscoverTopicsDeps) {}

  async execute(
    request: DiscoverTopicsRequest,
    signal: CancelSignal,
  ): AsyncResult<DiscoverTopicsReport, DiscoverTopicsError> {
    const { uow, discoverer, ids } = this.deps;
    const { workspaceId } = request;
    const messages: ClassifiableMessage[] = [];
    for (const id of [...request.messageIds].sort()) {
      const found = await uow.reads.messages.get(workspaceId, id);
      if (!found.ok) return found;
      messages.push(found.value);
    }
    const known = await uow.reads.topics.list(workspaceId);
    if (!known.ok) return known;
    const proposals = await discoverer.discover(messages, known.value, signal);
    if (!proposals.ok) return proposals;

    const { topics, created, topicsOf } = resolve(
      proposals.value,
      known.value,
      new Set<string>(messages.map((m) => m.id)),
      { workspaceId, ids },
    );

    const committed = await uow.run(async (tx) => {
      for (const topic of created) {
        const saved = await tx.repositories.topics.save(topic);
        if (!saved.ok) return saved;
      }
      for (const [messageId, set] of topicsOf) {
        const saved = await tx.repositories.messages.setTopics(
          workspaceId,
          messageId,
          [...set].sort(),
        );
        if (!saved.ok) return saved;
      }
      return ok(undefined);
    }, signal);
    if (!committed.ok) return committed;

    return ok({
      topics,
      assigned: topicsOf.size,
    });
  }
}

/** Maps proposals onto topics: an existing name reuses its topic, a new one gets a fresh id. */
function resolve(
  proposals: readonly TopicProposal[],
  known: readonly Topic[],
  inBatch: ReadonlySet<string>,
  scope: { readonly workspaceId: WorkspaceId; readonly ids: IdGenerator },
) {
  const byKey = new Map(known.map((t) => [keyOf(t.name), t]));
  const created: Topic[] = [];
  const topicsOf = new Map<MessageId, Set<TopicId>>();
  const topicFor = (raw: string): Topic | undefined => {
    const name = topicSchema.shape.name.safeParse(raw);
    if (!name.success) return undefined;
    const key = keyOf(name.data);
    const existing = byKey.get(key);
    if (existing !== undefined || byKey.size >= TOPICS_MAX) return existing;
    const id = topicIdSchema.safeParse(scope.ids.next("top"));
    if (!id.success) return undefined;
    const topic = {
      schemaVersion: 1 as const,
      id: id.data,
      workspaceId: scope.workspaceId,
      name: name.data,
    };
    byKey.set(key, topic);
    created.push(topic);
    return topic;
  };
  for (const p of proposals) {
    const topic = topicFor(p.name);
    if (topic === undefined) continue;
    for (const messageId of p.messageIds)
      if (inBatch.has(messageId))
        topicsOf.set(messageId, (topicsOf.get(messageId) ?? new Set()).add(topic.id));
  }
  const topics = [...byKey.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  return { topics, created, topicsOf };
}
