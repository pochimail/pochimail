import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import type { Topic } from "../model/topic.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";

export interface TopicCount {
  readonly id: Topic["id"];
  readonly name: string;
  readonly count: number;
}

/** Counts only: every topic with its emails for the selected accounts (0 when empty), by name (the sidebar's numbers). */
export class CountTopics {
  constructor(private readonly deps: { readonly uow: ClassificationUnitOfWork }) {}

  async execute(
    workspaceId: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<readonly TopicCount[], StorageError> {
    const { messages, topics } = this.deps.uow.reads;
    const counted = await messages.countByTopic(workspaceId, accountIds);
    if (!counted.ok) return counted;
    const known = await topics.list(workspaceId);
    if (!known.ok) return known;
    return ok(
      known.value
        .map((t) => ({ id: t.id, name: t.name, count: counted.value[t.id] ?? 0 }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    );
  }
}
