import { NotFound, type StorageError } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { byText, copy, type Data, key, paginate } from "../in-memory-store-data.ts";
import type { ReadRepositories } from "../uow-types.ts";

type Guarded = <T>(
  read: () => Result<T, StorageError | NotFound>,
) => Promise<Result<T, StorageError | NotFound>>;

/** The in-memory derived-data reads, failing like every other read when a fault is injected. */
export function derivedReads(data: () => Data, guarded: Guarded): ReadRepositories["derived"] {
  return {
    get: (ws, id) =>
      guarded(() => {
        const v = data().derived.get(key(ws, id));
        return v === undefined ? err(new NotFound("Derived data")) : ok(copy(v));
      }),
    listForMessages: (ws, ids) =>
      guarded(() => {
        const wanted = new Set<string>(ids);
        const rows = [...data().derived.values()].filter(
          (d) => d.workspaceId === ws && wanted.has(d.messageId),
        );
        return ok(rows.map(copy));
      }) as never,
    list: (ws, acc, page) =>
      guarded(() => {
        const rows = [...data().derived.values()]
          .filter((d) => d.workspaceId === ws && d.accountId === acc)
          .sort((a, b) => byText(a.messageId, b.messageId));
        return ok(paginate(rows, page));
      }) as never,
  };
}
