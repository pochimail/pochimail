import type { ActionLog } from "@pochimail/actions/model/action";
import type { Page, PageRequest } from "@pochimail/kernel/common";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { Message } from "@pochimail/mailbox/model/message";
import { copy, type Data, key } from "../in-memory-store-data.ts";

export function paginate<T>(sorted: readonly T[], page: PageRequest): Page<T> {
  const start = page.cursor === undefined ? 0 : Number(page.cursor);
  const items = sorted.slice(start, start + page.limit).map(copy);
  const end = start + items.length;
  return { items, nextCursor: end < sorted.length ? String(end) : null };
}
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

export const byText = (a: string, b: string) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};
