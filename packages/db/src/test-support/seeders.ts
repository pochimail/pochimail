import type { Seeder as ClassificationSeeder } from "@pochimail/classification/testing/samples";
import { makeDerived } from "@pochimail/classification/testing/samples";
import type { Seeder as CleanupSeeder } from "@pochimail/cleanup/testing/samples";
import { ok, unwrap } from "@pochimail/kernel/result";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { makeAccount, makeIncomingMessage, makeSender, WS_A } from "@pochimail/testing/fixtures";
import { expect } from "vitest";
import type { harness } from "./harness.ts";

type Harness = Pick<ReturnType<typeof harness>, "uow" | "committedOutbox">;

/** Stores the account once, then each message with its label and derived data, through one transaction. */
async function store(
  h: Harness,
  rows: Record<number, { incoming: object; category: string; derived: object | null }>,
) {
  const r = await h.uow.run(async (tx) => {
    await tx.repositories.accounts.save(makeAccount());
    for (const [key, row] of Object.entries(rows)) {
      const n = Number(key);
      const message = makeIncomingMessage(n, row.incoming as Partial<IncomingMessage>);
      unwrap(await tx.repositories.messages.upsertMany([message]));
      unwrap(await tx.repositories.messages.setCategory(WS_A, message.id, row.category));
      if (row.derived !== null)
        unwrap(
          await tx.repositories.derived.save(
            makeDerived(n, {
              category: row.category as never,
              snippet: message.snippet,
              ...row.derived,
            }),
          ),
        );
    }
    return ok(undefined);
  });
  expect(r.ok).toBe(true);
}

/** Arranges what the classification contracts need, over the real SQLite unit of work. */
export const classificationSeeder = (h: Harness): ClassificationSeeder => ({
  seed: (rows) =>
    store(
      h,
      Object.fromEntries(
        Object.entries(rows).map(([n, row]) => [
          n,
          {
            incoming: {
              ...row.message,
              ...(row.attachmentCount === undefined ? {} : { savedCount: row.attachmentCount }),
              ...(row.suspicious === undefined ? {} : { suspicious: row.suspicious }),
            },
            category: row.category ?? "notifications",
            derived: row.derived === undefined ? {} : row.derived,
          },
        ]),
      ),
    ),
  setSender: async (address, stats) => {
    const r = await h.uow.run(async (tx) =>
      tx.repositories.senders.upsert(makeSender({ address, ...stats })),
    );
    expect(r.ok).toBe(true);
  },
});

/** Arranges what the cleanup contracts need, over the real SQLite unit of work. */
export const cleanupSeeder = (h: Harness): CleanupSeeder => ({
  seed: (rows) =>
    store(
      h,
      Object.fromEntries(
        Object.entries(rows).map(([n, row]) => [
          n,
          {
            incoming: row.message ?? {},
            category: row.category ?? "notifications",
            derived: row.undecided
              ? null
              : {
                  ...(row.reason === undefined ? {} : { reason: row.reason }),
                  ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
                },
          },
        ]),
      ),
    ),
  eventTypes: async () =>
    (await h.committedOutbox()).flatMap((e) => (e.kind === "event" ? [e.event.type] : [])),
});
