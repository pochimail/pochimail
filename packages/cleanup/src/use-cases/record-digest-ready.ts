import { AccountId } from "@pochimail/kernel/ids";
import type { DigestReady } from "../events.ts";
import type { DigestTally } from "../ports/digest-tally.ts";

/** `digest:<account>:<since>`; `since` holds colons, so only the first segment is the account. */
const legacyAccount = (id: string): AccountId | undefined => {
  const prefix = "digest:";
  if (!id.startsWith(prefix)) return undefined;
  const rest = id.slice(prefix.length);
  const end = rest.indexOf(":");
  const account = AccountId(end === -1 ? rest : rest.slice(0, end));
  return account.ok ? account.value : undefined;
};

/** Feeds the digest button from `DigestReady` events (delivery is at-least-once, so the tally is idempotent on event id). */
export class RecordDigestReady {
  constructor(private readonly deps: { readonly tally: DigestTally }) {}

  execute(event: DigestReady): void {
    const accountId = event.payload.accountId ?? legacyAccount(event.id);
    // Without an account there is no digest to show; the event is not attributable to one.
    if (accountId === undefined) return;
    // The envelope time is the digest's generation time for events written before it was a payload field.
    this.deps.tally.record(event.id, {
      ...event.payload,
      accountId,
      generatedAt: event.payload.generatedAt ?? event.occurredAt,
    });
  }
}
