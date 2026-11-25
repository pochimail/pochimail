import { Offline } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { type Command, inverseOf } from "../model/action.ts";
import {
  type AppliedCommand,
  type MailCommands,
  type MailProviderCapabilities,
  type MailProviderError,
  PartiallyApplied,
} from "../ports/mail-commands.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";
import type { ActionHarness } from "./action-contract.ts";

export const BASE_CAPABILITIES = {
  organization: "labels",
  archive: "remove-inbox-label",
  deltaSync: true,
  pushWakeups: false,
  unsubscribeSend: true,
} as const;

interface MailboxState {
  readonly archived: Set<string>;
  readonly failing: Set<string>;
  partlyAt: string | null;
  mutations: number;
}

function applyOne(
  state: MailboxState,
  command: Command,
): Result<AppliedCommand, MailProviderError> {
  const ids = command.messageIds.map(String);
  if (state.partlyAt !== null && ids.includes(state.partlyAt)) {
    // Applies the ids before the failing one, then fails part-way.
    const done = command.messageIds.slice(0, ids.indexOf(state.partlyAt));
    for (const id of done) state.archived.add(String(id));
    state.mutations++;
    const part = { ...command, messageIds: done };
    return err(
      new PartiallyApplied(
        new Offline(),
        done.length === 0 ? [] : [{ command: part, inverse: inverseOf(part) }],
      ),
    );
  }
  if (ids.some((id) => state.failing.has(id))) return err(new Offline());
  for (const id of ids) {
    if (command.kind === "archive") state.archived.add(id);
    if (command.kind === "unarchive") state.archived.delete(id);
  }
  state.mutations++;
  return ok({ command, inverse: inverseOf(command) });
}

/** A mailbox that tracks archived messages, over any `ActionsUnitOfWork`: in memory or SQLite. */
export function createActionHarness(
  capabilities: MailProviderCapabilities,
  uow: ActionsUnitOfWork,
): ActionHarness & { failPartlyAt(id: string): void } {
  const state: MailboxState = {
    archived: new Set(),
    failing: new Set(),
    partlyAt: null,
    mutations: 0,
  };
  const provider: MailCommands = {
    capabilities,
    async applyCommands(commands) {
      const applied: AppliedCommand[] = [];
      for (const command of commands) {
        const one = applyOne(state, command);
        if (!one.ok) return one;
        applied.push(one.value);
      }
      return ok(applied);
    },
  };
  let n = 0;
  return {
    uow,
    provider,
    clock: { now: () => new Date("2026-11-17T10:00:00.000Z") },
    ids: { next: (prefix) => `${prefix}_${++n}` },
    isArchived: async (id) => state.archived.has(id),
    mutations: () => state.mutations,
    failPartlyAt: (id) => {
      state.partlyAt = id;
    },
    failFor: (ids) => {
      for (const id of ids) state.failing.add(id);
    },
  };
}
