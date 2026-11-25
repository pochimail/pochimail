import {
  accountIdSchema,
  schemaVersion,
  timestampSchema,
  workspaceIdSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";

/** Why a sender is protected from cleanup suggestions (ADR 0012). */
export const KEEP_RULE_TYPES = ["vip", "manual"] as const;
export const keepRuleTypeSchema = z.enum(KEEP_RULE_TYPES);

export const keepRuleSchema = z.object({
  schemaVersion,
  workspaceId: workspaceIdSchema,
  accountId: accountIdSchema,
  /** Keyed digest of the address; the address itself is never stored (ADR 0014). */
  senderHash: z.string().regex(/^[0-9a-f]{64}$/),
  ruleType: keepRuleTypeSchema,
  createdAt: timestampSchema,
});
export type KeepRule = z.infer<typeof keepRuleSchema>;
