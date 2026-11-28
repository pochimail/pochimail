import { z } from "zod";

/** The five fixed types (ADR 0016). Every message has exactly one; types drive actions, never protection. */
export const EMAIL_TYPES = [
  "personal",
  "transactional",
  "notification",
  "newsletter",
  "promotion",
] as const;
export const emailTypeSchema = z.enum(EMAIL_TYPES);
export type EmailType = z.infer<typeof emailTypeSchema>;
/** A message that arrives unclassified is filed here until the classifier says otherwise. */
export const DEFAULT_EMAIL_TYPE: EmailType = "notification";
/** Narrows a stored message's opaque `category` label (the mailbox does not know the closed set). */
export const emailTypeOf = (message: { readonly category: string }): EmailType =>
  emailTypeSchema.parse(message.category);
