import { createHash } from "node:crypto";

/** A stable, fixed-length code for a rule's text. The text itself is never persisted (ADR 0014). */
export function reasonCode(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
