import { NotFound, type StorageError } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { SenderOfMessage } from "@pochimail/mailbox/ports/sender-repository";
import { copy, type Data, key } from "../in-memory-store-data.ts";
import type { ReadRepositories } from "../uow-types.ts";
import { mailboxFactsOver } from "./mailbox-facts.ts";
import { figuresOver } from "./overview-figures.ts";
import { signalFactsOver } from "./signal-facts.ts";

/** What the stored message says of its sender, as the SQLite adapter answers it from the sender hash. */
export function senderOfMessage(
  data: Data,
  ws: string,
  id: string,
  ownerAddress: string,
): Result<SenderOfMessage, NotFound> {
  const m = data.messages.get(key(ws, id));
  if (m === undefined) return err(new NotFound("Message"));
  if (m.from === "") return ok({ fromOwner: undefined, stats: undefined });
  const stats = data.senders.get(key(ws, m.accountId, m.from));
  return ok({
    fromOwner: m.from.toLowerCase() === ownerAddress.toLowerCase(),
    stats: stats === undefined ? undefined : copy(stats),
  });
}

/** The in-memory domain views: figures read from rows like SQLite, with the same injected faults. */
type BaseReads = Omit<ReadRepositories, "mailboxFacts" | "signalFacts">;

export function inMemoryReads(
  base: BaseReads,
  data: () => Data,
  fail: () => StorageError | null | undefined,
): ReadRepositories {
  const figures = figuresOver(data);
  return {
    ...base,
    signalFacts: signalFactsOver(base),
    mailboxFacts: mailboxFactsOver({
      ...base,
      figures: (ws, accountIds) => {
        const failure = fail();
        return Promise.resolve(failure ? err(failure) : figures(ws, accountIds));
      },
    }),
  };
}
