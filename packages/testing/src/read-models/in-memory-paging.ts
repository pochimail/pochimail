import type { ActionLog } from "@pochimail/actions/model/action";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { Message } from "@pochimail/mailbox/model/message";
import { byText, copy, type Data, key } from "../in-memory-store-data.ts";

export const oldestFirst = (
  log: Map<string, ActionLog>,
  ws: WorkspaceId,
  match: (l: ActionLog) => boolean = () => true,
) =>
  [...log.values()]
    .filter((l) => l.workspaceId === ws && match(l))
    .sort((a, b) => byText(a.at, b.at))
    .map(copy);
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
