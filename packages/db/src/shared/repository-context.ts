import type { SenderHasher } from "@pochimail/mailbox/ports/sender-hasher";
import type { DisplayFieldsCache } from "../mailbox/display-fields-cache.ts";

/** One unit of work's in-memory private fields and the keyed digest used by every repository. */
export interface RepositoryContext {
  readonly cache: DisplayFieldsCache;
  readonly senderHasher: SenderHasher;
}
