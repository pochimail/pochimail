import { z } from "zod";

/**
 * The cleanup and activity procedures (#270, #138): ids, enums and counts only, never an address, name,
 * subject or URL (ADR 0014). There is no `delete` kind and no way to empty the Trash (ADR 0012).
 */
const accountId = z.string().min(1).max(200);
const count = z.number().int().nonnegative();
const batchId = z.string().min(1).max(200);
const actionId = z.string().min(1).max(200);

/** What the person can approve: delete means move to the provider's Trash (ADR 0012). */
/** Entries per page when the caller names no limit. */
export const ACTIVITY_PAGE_SIZE = 50;

const APPLY_KINDS = ["archive", "trash"] as const;
/** What Activity lists: the apply kinds plus the unsubscribe the Review sends on its own path (#135). */
const ENTRY_KINDS = ["archive", "unarchive", "trash", "untrash", "unsubscribe", "other"] as const;
const ENTRY_OUTCOMES = ["applied", "undone", "failed", "refused"] as const;
const UNDO_STATES = ["available", "irreversible", "unavailable"] as const;

export const cleanupQueries = {
  "cleanup.suggestions": {
    input: z.object({ accountIds: z.array(accountId).max(100).optional() }),
    output: z
      .array(
        z.object({
          id: z.string().min(1).max(400),
          accountId,
          kind: z.enum(["archive", "unsubscribe"]),
          messageCount: count,
          confidence: z.number().min(0).max(1),
          reasons: z.array(z.string().min(1).max(200)).max(20),
        }),
      )
      .max(10_000),
  },
  /** One entry per action (the log's pending and final rows collapsed), newest first. */
  "activity.list": {
    input: z.object({
      accountIds: z.array(accountId).max(100).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().min(1).max(200).optional(),
    }),
    output: z.object({
      entries: z
        .array(
          z.object({
            actionId,
            batchId: batchId.optional(),
            kind: z.enum(ENTRY_KINDS),
            messageCount: count,
            /** Null once the account was removed: the entry stays as a record with no undo. */
            accountId: accountId.nullable(),
            outcome: z.enum(ENTRY_OUTCOMES),
            at: z.iso.datetime(),
            undo: z.enum(UNDO_STATES),
          }),
        )
        .max(200),
      nextCursor: z.string().nullable(),
    }),
  },
} as const;

export const cleanupMutations = {
  "cleanup.propose": {
    input: z.object({ accountId }),
    output: z.object({ created: count }),
  },
  "cleanup.apply": {
    input: z.object({
      accountId,
      kind: z.enum(APPLY_KINDS),
      messageIds: z.array(z.string().min(1).max(200)).min(1).max(20_000),
      suggestionId: z.string().min(1).max(400).optional(),
      confirmed: z.literal(true),
    }),
    output: z.object({ batchId, applied: count, refused: count, failed: count }),
  },
  "cleanup.undo": {
    input: z.union([z.object({ batchId }).strict(), z.object({ actionId }).strict()]),
    output: z.object({
      undone: count,
      alreadyUndone: count,
      irreversible: count,
      notApplied: count,
      failed: count,
    }),
  },
} as const;
