import type { StorageError } from "@pochimail/kernel/errors";
import { err } from "@pochimail/kernel/result";
import type { Data } from "../in-memory-store-data.ts";
import type { ReadRepositories } from "../uow-types.ts";
import { mailboxFactsOver } from "./mailbox-facts.ts";
import { figuresOver } from "./overview-figures.ts";
import { signalFactsOver } from "./signal-facts.ts";

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
