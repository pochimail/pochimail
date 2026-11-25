import { type Message, messageSchema } from "@pochimail/mailbox/model/message";
import type { Row } from "../shared/sql.ts";
import { flag, json, placeholderAddress, text } from "../shared/values.ts";
import type { DisplayFieldsCache } from "./display-fields-cache.ts";
import { decodeReasons } from "./suspicious-reasons.ts";

export const MESSAGE_COLUMNS =
  "workspace_id, id, account_id, thread_id, sender_hash, received_at, has_list_unsubscribe, opened, size, saved_count, saved_size, archived, topic_ids, suspicious_reason_code, suspicious_confidence, category";

/** A row holds codes and counts; subject, addresses, recipients and snippet come from the cache. */
export const messageOf = (r: Row, cache: DisplayFieldsCache): Message => {
  const ws = text(r.workspace_id);
  const id = text(r.id);
  const fields = cache.of(ws, id);
  const code = r.suspicious_reason_code === null ? undefined : text(r.suspicious_reason_code);
  const suspicious =
    fields.suspicious ??
    (code === undefined
      ? undefined
      : {
          reasons: decodeReasons(code),
          confidence: typeof r.suspicious_confidence === "number" ? r.suspicious_confidence : 0.5,
        });
  return messageSchema.parse({
    schemaVersion: 1,
    id,
    workspaceId: ws,
    accountId: r.account_id,
    threadId: r.thread_id,
    from: fields.from ?? placeholderAddress(text(r.sender_hash)),
    to: fields.to ?? [],
    subject: fields.subject ?? "",
    snippet: fields.snippet ?? "",
    receivedAt: r.received_at,
    hasListUnsubscribe: flag(r.has_list_unsubscribe),
    opened: flag(r.opened),
    ...(r.size === null ? {} : { size: r.size }),
    ...(r.saved_count === null ? {} : { savedCount: r.saved_count }),
    ...(r.saved_size === null ? {} : { savedSize: r.saved_size }),
    // NULL is unknown (a row stored before the action log said anything); only 0/1 are facts.
    ...(r.archived === null ? {} : { archived: flag(r.archived) }),
    topicIds: json(r.topic_ids),
    ...(suspicious === undefined ? {} : { suspicious }),
    category: r.category,
    senderHash: text(r.sender_hash),
  });
};
