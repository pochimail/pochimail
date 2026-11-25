import { unwrap } from "@pochimail/kernel/result";
import { RunIncrementalSync } from "@pochimail/workflows/use-cases/run-incremental-sync";
import { expect, it } from "vitest";
import { createFakeClock } from "./fake-clock.ts";
import { createFakeMailProvider } from "./fake-mail-provider.ts";
import { ACCOUNT_1, makeAccount, makeIncomingMessage, WS_A } from "./fixtures.ts";
import { createInMemoryUnitOfWork } from "./in-memory-store.ts";

it("an incremental run announces no scan progress or completion (guards a delta run overwriting the first scan's final count)", async () => {
  // Guards: a delta run announcing its own total as scan progress, so the screen shows a smaller number.
  const store = createInMemoryUnitOfWork();
  unwrap(await store.uow.run((tx) => tx.repositories.accounts.save(makeAccount())));
  const provider = createFakeMailProvider({ pageSize: 2 });
  provider.deliver(...[1, 2, 3].map((n) => makeIncomingMessage(n)));
  const outcome = unwrap(
    await new RunIncrementalSync({
      uow: store.uow,
      provider,
      clock: createFakeClock(),
    }).execute({ workspaceId: WS_A, accountId: ACCOUNT_1 }, new AbortController().signal),
  );
  expect(outcome).toMatchObject({ status: "completed", stored: 3 });
  const types = (await store.committedOutbox()).flatMap((entry) =>
    entry.kind === "event" ? [entry.event.type] : [],
  );
  expect(types).toContain("MessagesUpserted");
  expect(types).not.toContain("ScanProgressed");
  expect(types).not.toContain("ScanCompleted");
});
