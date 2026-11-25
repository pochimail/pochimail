import type { Command } from "@pochimail/actions/model/action";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import { describe, expectTypeOf, it } from "vitest";
import type { Transaction, UnitOfWork } from "./uow-types.ts";

// Compile-time tests: `pnpm typecheck` fails if any @ts-expect-error stops being an error.

/** A use case that never learns which provider it talks to: it reads capabilities only. */
async function archiveInChunks(provider: MailProvider, commands: readonly Command[]) {
  const size = provider.capabilities.batchModify?.maxCommands ?? 1;
  const chunks: Command[][] = [];
  for (let i = 0; i < commands.length; i += size) chunks.push(commands.slice(i, i + size));
  const flavour =
    provider.capabilities.archive === "move-to-archive-folder" ? "folder move" : "label removal";
  return { chunks, flavour };
}

describe("port type tests", () => {
  it("a use case compiles against MailProvider capabilities with no provider kind (guards name-based branching)", () => {
    expectTypeOf(archiveInChunks).parameter(0).toEqualTypeOf<MailProvider>();
    // @ts-expect-error capabilities carry no provider name to branch on
    expectTypeOf<MailProvider["capabilities"]>().toHaveProperty("kind");
    // @ts-expect-error neither does the provider itself
    expectTypeOf<MailProvider>().toHaveProperty("kind");
  });

  it("the outbox is reachable only through a Transaction (guards appending outside a transaction)", () => {
    expectTypeOf<Transaction>().toHaveProperty("outbox");
    // @ts-expect-error UnitOfWork has no outbox of its own
    expectTypeOf<UnitOfWork>().toHaveProperty("outbox");
    // Every read repository, whatever its name, exposes no mutating method.
    type Reads = UnitOfWork["reads"];
    type Mutating =
      | "save"
      | "upsert"
      | "upsertMany"
      | "append"
      | "set"
      | "setCategory"
      | "setTopics"
      | "delete";
    type MutatingOnReads = { [K in keyof Reads]: Extract<keyof Reads[K], Mutating> }[keyof Reads];
    expectTypeOf<MutatingOnReads>().toBeNever();
    // And the read side covers exactly the repositories the write side has, plus the composed read models.
    type ReadModels = "signalFacts" | "mailboxFacts";
    expectTypeOf<Exclude<keyof Reads, ReadModels>>().toEqualTypeOf<
      keyof Transaction["repositories"]
    >();
  });
});
