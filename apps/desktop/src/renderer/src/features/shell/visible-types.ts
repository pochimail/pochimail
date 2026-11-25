import { EMAIL_TYPES, type EmailType } from "@pochimail/classification/model/email-type";

/** D5: a type with no email for the current selection is not shown; it appears as soon as it has mail. */
export const visibleTypes = (counts: Readonly<Partial<Record<EmailType, number>>> | undefined) =>
  EMAIL_TYPES.flatMap((id) => {
    const count = counts?.[id] ?? 0;
    return count > 0 ? [{ id, count }] : [];
  });
