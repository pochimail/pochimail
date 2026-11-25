import { CATEGORIES } from "@pochimail/classification/model/category";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import { ok, type Result } from "@pochimail/kernel/result";
import { byText, type Data, key } from "../in-memory-store-data.ts";
import type { ReadRepositories } from "../uow-types.ts";

type Guarded = <T>(
  read: () => Result<T, StorageError | NotFound>,
) => Promise<Result<T, StorageError | NotFound>>;

/** The in-memory message reads that look at classification: emails per label, and mail with no decision yet. */
export const categoryReads = (
  data: () => Data,
  guarded: Guarded,
): Pick<ReadRepositories["messages"], "countByCategory" | "listUnclassified"> => ({
  countByCategory: (ws, accountIds) =>
    guarded(() => {
      const counts: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
      for (const m of data().messages.values())
        if (m.workspaceId === ws && accountIds.includes(m.accountId))
          counts[m.category] = (counts[m.category] ?? 0) + 1;
      return ok(counts);
    }) as never,
  listUnclassified: (ws, accountId, limit) =>
    guarded(() =>
      ok(
        [...data().messages.values()]
          .filter(
            (m) =>
              m.workspaceId === ws &&
              m.accountId === accountId &&
              !data().derived.has(key(ws, m.id)),
          )
          .map((m) => m.id)
          .sort(byText)
          .slice(0, Math.max(0, limit)),
      ),
    ) as never,
});
