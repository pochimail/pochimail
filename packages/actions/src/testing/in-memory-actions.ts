import { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { EventEnvelope } from "@pochimail/kernel/event";
import { err, ok } from "@pochimail/kernel/result";
import { type ActionLog, unresolvedPending } from "../model/action.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface InMemoryActions {
  readonly uow: ActionsUnitOfWork;
  /** Events committed so far, in order; a rolled-back transaction leaves none. */
  committedEvents(): readonly EventEnvelope[];
}

/** The action log and its events in memory, append-only, with commit-or-roll-back like the real unit of work. */
export function createInMemoryActions(): InMemoryActions {
  let logs: ActionLog[] = [];
  let events: EventEnvelope[] = [];
  const reads: ActionsUnitOfWork["reads"]["actionLog"] = {
    get: async (ws, id) => {
      const found = logs.find((e) => e.workspaceId === ws && e.id === id);
      return found ? ok(copy(found)) : err(new NotFound("Action log entry"));
    },
    listForAction: async (ws, id) =>
      ok(logs.filter((e) => e.workspaceId === ws && e.actionId === id).map(copy)),
    listForKey: async (ws, key) =>
      ok(logs.filter((e) => e.workspaceId === ws && e.idempotencyKey === key).map(copy)),
    listForBatch: async (ws, id) =>
      ok(logs.filter((e) => e.workspaceId === ws && e.batchId === id).map(copy)),
    lastSeq: async (ws) => ok(logs.findLastIndex((e) => e.workspaceId === ws) + 1),
    listPending: async (ws, bootSeq) =>
      ok(
        unresolvedPending(
          logs.map((entry, i) => ({ seq: i + 1, entry })).filter((r) => r.entry.workspaceId === ws),
          bootSeq,
        ).map(copy),
      ),
    list: async (ws) =>
      ok({ items: logs.filter((e) => e.workspaceId === ws).map(copy), nextCursor: null }),
  };
  return {
    committedEvents: () => events.map(copy),
    uow: {
      reads: { actionLog: reads },
      async run(work) {
        const draft = { logs: [...logs], events: [...events] };
        const result = await work({
          repositories: {
            actionLog: {
              ...reads,
              append: async (entry) => {
                if (
                  draft.logs.some((e) => e.workspaceId === entry.workspaceId && e.id === entry.id)
                )
                  return err(new StorageError("Action log entry already exists"));
                draft.logs.push(copy(entry));
                return ok(undefined);
              },
            },
          },
          events: {
            append: async (batch) => {
              draft.events.push(...copy(batch));
              return ok(undefined);
            },
          },
        });
        if (result.ok) ({ logs, events } = draft);
        return result;
      },
    },
  };
}
