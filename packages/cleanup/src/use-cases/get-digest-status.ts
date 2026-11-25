import type { AccountId } from "@pochimail/kernel/ids";
import type { DigestStatus, DigestTally } from "../ports/digest-tally.ts";

/** What one account's digest button shows now. */
export class GetDigestStatus {
  constructor(private readonly deps: { readonly tally: DigestTally }) {}

  execute(accountId: AccountId): DigestStatus {
    return this.deps.tally.status(accountId);
  }
}
