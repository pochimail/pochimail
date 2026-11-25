import { accountEvents } from "@pochimail/accounts/events";
import { actionEvents } from "@pochimail/actions/events";
import { classificationEvents } from "@pochimail/classification/events";
import { cleanupEvents } from "@pochimail/cleanup/events";
import { documentEvents } from "@pochimail/documents/events";
import { ERROR_CODES } from "@pochimail/kernel/errors";
import { defineEvent } from "@pochimail/kernel/event-schema";
import { accountIdSchema } from "@pochimail/kernel/schemas";
import { mailboxEvents } from "@pochimail/mailbox/events";
import { z } from "zod";

/**
 * Payloads carry IDs, enums and counts only: never subjects, addresses or bodies (AGENTS §5).
 * Objects are non-strict on purpose: zod strips unknown keys, so a stray `subject` never
 * reaches a subscriber.
 */
const count = z.number().int().nonnegative();

/** The scan's own events; every other event belongs to the domain that emits it. */
export const scanEvents = [
  defineEvent(
    "ScanProgressed",
    z.object({ accountId: accountIdSchema, processed: count, total: count.optional() }),
  ),
  defineEvent("ScanCompleted", z.object({ accountId: accountIdSchema, processed: count })),
  /** A sync after the first scan stored or classified mail; sent only when something changed, never as scan progress. */
  defineEvent(
    "SyncCompleted",
    z.object({ accountId: accountIdSchema, stored: count, classified: count }),
  ),
  defineEvent(
    "ScanFailed",
    z.object({ accountId: accountIdSchema, errorCode: z.enum(ERROR_CODES) }),
  ),
] as const;

/** Every event that crosses a domain boundary: the one catalog the bus validates against. */
export const domainEventSchema = z.discriminatedUnion("type", [
  ...accountEvents,
  ...mailboxEvents,
  ...classificationEvents,
  ...cleanupEvents,
  ...actionEvents,
  ...documentEvents,
  ...scanEvents,
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = DomainEvent["type"];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/** Validates untrusted input; the bus takes this as its `parse`. */
export function parseDomainEvent(input: unknown): DomainEvent | undefined {
  const parsed = domainEventSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}
