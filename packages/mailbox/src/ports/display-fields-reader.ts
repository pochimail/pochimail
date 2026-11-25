import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { messageIdSchema } from "@pochimail/kernel/schemas";
import { z } from "zod";

/** What a screen may show, fetched live by id and held in memory only (ADR 0014). */
export const displayFieldsSchema = z.object({
  id: messageIdSchema,
  subject: z.string(),
  snippet: z.string(),
});
export type DisplayFields = z.infer<typeof displayFieldsSchema>;

/** Provider-neutral live read of display fields by id; adapters batch the provider calls. */
export interface DisplayFieldsReader<E extends Error = Error> {
  fetchDisplayFields(
    ids: readonly string[],
    signal: CancelSignal,
  ): AsyncResult<readonly DisplayFields[], E>;
}
