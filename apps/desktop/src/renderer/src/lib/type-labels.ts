import type { EmailType } from "@pochimail/classification/model/email-type";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";

/** One translated label per type id, shared by the sidebar and the type screen. */
export const TYPE_LABELS: Readonly<Record<EmailType, MessageKey>> = {
  personal: "type.personal",
  transactional: "type.transactional",
  notification: "type.notification",
  newsletter: "type.newsletter",
  promotion: "type.promotion",
};

/** Route params are opaque strings; an unknown id keeps its raw label. */
export const typeLabelKey = (id: string): MessageKey | undefined =>
  (TYPE_LABELS as Readonly<Partial<Record<string, MessageKey>>>)[id];
