import { schemaVersion, topicIdSchema, workspaceIdSchema } from "@pochimail/kernel/schemas";
import { z } from "zod";

export const TOPIC_NAME_MAX = 60;
export const TOPICS_MAX = 50;

export const topicSchema = z.object({
  schemaVersion,
  id: topicIdSchema,
  workspaceId: workspaceIdSchema,
  name: z.string().trim().min(1).max(TOPIC_NAME_MAX),
});
export type Topic = z.infer<typeof topicSchema>;
