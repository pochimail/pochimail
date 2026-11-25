import { t } from "@pochimail/ui/i18n/format.ts";
import type { MessageKey, MessageValues } from "@pochimail/ui/i18n/messages.ts";

/** The English text of a catalog entry: tests find controls by what the user reads, and follow a copy change instead of breaking on it. */
export const copy = <K extends MessageKey>(key: K, values?: MessageValues<K>): string =>
  t(key, values, { locale: "en" });
