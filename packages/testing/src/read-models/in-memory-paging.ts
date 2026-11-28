import type { ActionLog } from "@pochimail/actions/model/action";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { Message } from "@pochimail/mailbox/model/message";
import { copy, type Data, key } from "../in-memory-store-data.ts";

/** The action log in insertion order, each entry with its 1-based sequence number. */
export const sequenced = (log: Map<string, ActionLog>, ws: WorkspaceId) =>
  [...log.values()]
    .map((entry, seq) => ({ seq: seq + 1, entry }))
    .filter((r) => r.entry.workspaceId === ws);
export const oldestFirst = (
  log: Map<string, ActionLog>,
  ws: WorkspaceId,
  match = (_: ActionLog) => true,
) =>
  sequenced(log, ws)
    .filter((r) => match(r.entry))
    .map((r) => copy(r.entry));
export function inSequenceRange(
  data: Data,
  m: Message,
  q: { afterSequence?: number; throughSequence?: number },
): boolean {
  const seq = data.messageSequence.get(key(m.workspaceId, m.id)) ?? 0;
  return (
    (q.afterSequence === undefined || seq > q.afterSequence) &&
    (q.throughSequence === undefined || seq <= q.throughSequence)
  );
}
