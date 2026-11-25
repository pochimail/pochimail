import type { CancelSignal } from "@pochimail/kernel/common";
import { Cancelled } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import {
  type DisplayFields,
  type DisplayFieldsReader,
  displayFieldsSchema,
} from "@pochimail/mailbox/ports/display-fields-reader";

/**
 * Deterministic stand-in for a provider's live-by-id display-field read (ADR 0014). It keeps the
 * values in memory only, validates them at the boundary and honours cancellation, like an adapter.
 */
export function createFakeDisplayFieldsReader(
  fields: readonly DisplayFields[] = [],
): DisplayFieldsReader<Cancelled> {
  const byId = new Map<string, DisplayFields>(
    fields.map((field) => {
      const parsed = displayFieldsSchema.parse(field);
      return [parsed.id, parsed] as const;
    }),
  );
  return {
    async fetchDisplayFields(ids, signal: CancelSignal) {
      if (signal.aborted) return err(new Cancelled());
      const found = ids
        .map((id) => byId.get(id))
        .filter((field): field is DisplayFields => field !== undefined);
      return ok(displayFieldsSchema.array().parse(found));
    },
  };
}
