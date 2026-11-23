import { type Message, messageSchema } from "@pochimail/mailbox/model/message";
import type { Row } from "../shared/sql.ts";
import { flag, json } from "../shared/values.ts";

export const MESSAGE_COLUMNS =
  "workspace_id, id, account_id, thread_id, sender, recipients, subject, snippet, received_at, has_list_unsubscribe, opened, size, saved_count, saved_size, archived, topic_ids, suspicious_reasons, suspicious_confidence, category";

export const messageOf = (r: Row): Message =>
  messageSchema.parse({
    schemaVersion: 1,
    id: r.id,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    threadId: r.thread_id,
    from: r.sender,
    to: json(r.recipients),
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    hasListUnsubscribe: flag(r.has_list_unsubscribe),
    opened: flag(r.opened),
    ...(r.size === null ? {} : { size: r.size }),
    ...(r.saved_count === null ? {} : { savedCount: r.saved_count }),
    ...(r.saved_size === null ? {} : { savedSize: r.saved_size }),
    // NULL is unknown (a row stored before the action log said anything); only 0/1 are facts.
    ...(r.archived === null ? {} : { archived: flag(r.archived) }),
    topicIds: json(r.topic_ids),
    ...(r.suspicious_reasons === null
      ? {}
      : {
          suspicious: { reasons: json(r.suspicious_reasons), confidence: r.suspicious_confidence },
        }),
    category: r.category,
  });
