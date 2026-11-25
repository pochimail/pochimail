import type { ActionLog } from "@pochimail/actions/model/action";
import { DEFAULT_EMAIL_TYPE } from "@pochimail/classification/model/email-type";
import { fakeSenderHash } from "@pochimail/kernel/testing/fake-sender-hash";
import type { IncomingMessage, Message } from "@pochimail/mailbox/model/message";
import { copy, type Data, key } from "../in-memory-store-data.ts";

/**
 * What SQL's action-log append writes besides the row itself (#114): the owner account for
 * per-account figures and the archive marker on the messages stored at append time. A later
 * re-sync keeps that marker; a failed or refused entry changes nothing.
 */
export function applyActionEffects(data: Data, k: string, entry: ActionLog): void {
  const first = entry.command.messageIds[0] ?? "";
  const owner = data.messages.get(key(entry.workspaceId, first));
  if (owner !== undefined) data.actionLogAccount.set(k, owner.accountId);
  const { kind } = entry.command;
  if (
    (entry.outcome !== "applied" && entry.outcome !== "undone") ||
    (kind !== "archive" && kind !== "unarchive")
  )
    return;
  for (const id of entry.command.messageIds) {
    const mk = key(entry.workspaceId, id);
    const m = data.messages.get(mk);
    if (m !== undefined) data.messages.set(mk, { ...m, archived: kind === "archive" });
  }
}

/**
 * The upserted message row (#114): a re-sync keeps the category and the archive marker an executed
 * action set at append time, so scanning the same mailbox again never erases the figures' history.
 */
export function storeMessage(m: IncomingMessage, existing: Message | undefined): Message {
  return copy({
    ...m,
    category: existing?.category ?? DEFAULT_EMAIL_TYPE,
    topicIds: existing?.topicIds ?? m.topicIds,
    senderHash: fakeSenderHash(m.accountId, m.from),
    ...(existing?.archived === undefined ? {} : { archived: existing.archived }),
  });
}
