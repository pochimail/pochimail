import type { ActionLog } from "@pochimail/actions/model/action";
import { InvalidStateError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { WorkflowUnitOfWork } from "@pochimail/workflows/ports/unit-of-work";
import { ACTIVITY_PAGE_SIZE } from "../shared/ipc/cleanup-contract.ts";
import type { OutputOf } from "../shared/ipc/contract.ts";
import type { Handlers } from "../shared/ipc/server.ts";
import { accountOfEntry } from "./account-of-entry.ts";

type Entry = OutputOf<"activity.list">["entries"][number];

const KINDS: readonly Entry["kind"][] = ["archive", "unarchive", "trash", "untrash", "unsubscribe"];

const unwrapOrThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

interface Settled {
  readonly applied: readonly ActionLog[];
  readonly reversed: boolean;
  readonly failed: boolean;
}

function outcomeOf(
  { applied, reversed, failed }: Settled,
  rows: readonly ActionLog[],
): Entry["outcome"] {
  if (applied.length > 0) {
    if (reversed) return "undone";
    return failed ? "failed" : "applied";
  }
  return failed || !rows.some((row) => row.outcome === "refused") ? "failed" : "refused";
}

function undoOf({ applied, reversed }: Settled): Entry["undo"] {
  if (applied.length === 0 || reversed) return "unavailable";
  return applied.some((row) => row.irreversible || row.inverse === null)
    ? "irreversible"
    : "available";
}

/**
 * One action's rows (a `pending` row, then its final ones) as one entry. An action that only has its
 * `pending` row is still running or waits for crash recovery (#249): it is not an entry yet.
 */
function collapse(rows: readonly ActionLog[]): Omit<Entry, "accountId"> | undefined {
  const first = rows[0];
  const last = rows.at(-1);
  const settled = rows.filter((row) => row.outcome !== "pending");
  if (first === undefined || last === undefined || settled.length === 0) return undefined;
  const applied = settled.filter((row) => row.outcome === "applied");
  const undone = settled.filter((row) => row.outcome === "undone").length;
  const state: Settled = {
    applied,
    reversed: applied.length > 0 && undone >= applied.length,
    failed: settled.some((row) => row.outcome === "failed"),
  };
  return {
    actionId: first.actionId,
    ...(first.batchId === undefined ? {} : { batchId: first.batchId }),
    kind: KINDS.find((k) => k === first.command.kind) ?? "other",
    messageCount: first.command.messageIds.length,
    outcome: outcomeOf(state, rows),
    at: last.at,
    undo: undoOf(state),
  };
}

type Uow = WorkflowUnitOfWork;

/** Every log row grouped by action, in write order. */
async function rowsByAction(uow: Uow, workspaceId: WorkspaceId): Promise<ActionLog[][]> {
  const byAction = new Map<string, ActionLog[]>();
  let next: string | undefined;
  do {
    const page = unwrapOrThrow(
      await uow.reads.actionLog.list(workspaceId, {
        limit: 500,
        ...(next === undefined ? {} : { cursor: next }),
      }),
    );
    for (const row of page.items)
      byAction.set(row.actionId, [...(byAction.get(row.actionId) ?? []), row]);
    next = page.nextCursor ?? undefined;
  } while (next !== undefined);
  return [...byAction.values()];
}

const newestFirst = (a: Entry, b: Entry): number => {
  if (a.at === b.at) return 0;
  return a.at < b.at ? 1 : -1;
};

/** Every action as an entry of its account (or none once the account was removed, so with no undo). */
async function allEntries(uow: Uow, workspaceId: WorkspaceId): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const rows of await rowsByAction(uow, workspaceId)) {
    const entry = collapse(rows);
    const first = rows[0];
    if (entry === undefined || first === undefined) continue;
    const account = await accountOfEntry(uow, workspaceId, first);
    entries.push({
      ...entry,
      accountId: account?.id ?? null,
      undo: account === undefined ? "unavailable" : entry.undo,
    });
  }
  entries.reverse(); // newest write first among equal times
  return entries.sort(newestFirst);
}

/** `activity.list` (#138): the action log read through the actions repository, newest first, paged by offset. */
export function createActivityProcedures(deps: {
  readonly workspaceId: WorkspaceId;
  readonly uow: Uow;
}): Handlers["procedures"] {
  const { uow, workspaceId } = deps;
  return {
    "activity.list": async ({ accountIds, limit = ACTIVITY_PAGE_SIZE, cursor }) => {
      const entries = (await allEntries(uow, workspaceId)).filter(
        (entry) => accountIds === undefined || accountIds.includes(entry.accountId ?? ""),
      );
      const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
      if (!Number.isInteger(start) || start < 0) throw new InvalidStateError("Bad cursor");
      const end = start + limit;
      return {
        entries: entries.slice(start, end),
        nextCursor: end < entries.length ? String(end) : null,
      };
    },
  };
}
