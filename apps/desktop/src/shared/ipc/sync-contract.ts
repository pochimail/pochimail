import { z } from "zod";

const accountId = z.string().min(1).max(200);
const count = z.number().int().nonnegative();

/** How one sync ended, as a closed set the screen can explain; never a provider message, URL or token. */
export const syncResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), stored: count, restarted: z.boolean() }),
  /** The first scan is the sync until it has finished; its own progress shows it. */
  z.object({ status: z.literal("first-scan") }),
  z.object({ status: z.literal("paused") }),
  /** Epoch milliseconds when sync resumes by itself. */
  z.object({ status: z.literal("rate-limited"), resumeAt: count }),
  z.object({ status: z.literal("needs-reauth") }),
  z.object({ status: z.literal("offline") }),
  z.object({ status: z.literal("failed") }),
]);

export type SyncResultView = z.output<typeof syncResultSchema>;

export const syncQueries = {
  /** Read-only: whether each account is syncing and how its last sync ended, so a screen can show it after a reload. */
  "sync.status": {
    input: z.object({ accountIds: z.array(accountId).max(100) }),
    output: z
      .array(
        z.object({
          accountId,
          running: z.boolean(),
          last: z.object({ result: syncResultSchema, at: count }).nullable(),
        }),
      )
      .max(100),
  },
} as const;

export const syncMutations = {
  /** Syncs the account named, or every account when none is; the same sync the scheduler runs, never a second one at once. */
  "sync.now": {
    input: z.object({ accountId: accountId.optional() }),
    output: z.object({
      results: z.array(z.object({ accountId, result: syncResultSchema })).max(100),
    }),
  },
} as const;

export const syncChangedEvent = z.object({
  type: z.literal("SyncChanged"),
  accountId,
  running: z.boolean(),
  /** Present when the sync ended. */
  result: syncResultSchema.optional(),
});
