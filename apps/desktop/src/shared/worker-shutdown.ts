import { z } from "zod";

/** What the worker tells main once it has released the database during a graceful shutdown (ADR 0002). */
export const databaseClosedSchema = z.object({ type: z.literal("database-closed") });
export const DATABASE_CLOSED: z.infer<typeof databaseClosedSchema> = { type: "database-closed" };
