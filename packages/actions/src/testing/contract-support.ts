import type { Clock } from "@pochimail/kernel/clock";
import type { CancelSignal } from "@pochimail/kernel/common";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { ActionId } from "../ids.ts";
import type { Action, Command } from "../model/action.ts";
import type { MailCommands, MailProviderError } from "../ports/mail-commands.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";
import type { ApplyActionItem } from "../use-cases/apply-action.ts";

/**
 * What the suite needs from a mailbox + storage pair. Adapters (SQLite, real providers against
 * fixtures) implement it and run `describeActionUseCases` unchanged.
 */
export interface ActionHarness {
  readonly uow: ActionsUnitOfWork;
  readonly provider: MailCommands;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Mailbox state as the provider sees it. */
  isArchived(messageId: string): Promise<boolean>;
  /** Number of mutations the provider actually performed (replays must not add any). */
  mutations(): number;
  /** Makes the provider fail for every command touching one of these messages; an empty list heals it. */
  failFor(messageIds: readonly string[]): void;
  /** Makes the next provider call, and only that one, fail with `error` without changing anything. */
  failNext(error: MailProviderError): void;
}

export const signal: CancelSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};
export const ws = unwrap(WorkspaceId("wsp_1"));
/** A boot mark past every entry: lists all unresolved `pending` entries. */
export const ALL_ENTRIES = Number.MAX_SAFE_INTEGER;
export const confirmed: ApplyActionItem["authorization"] = {
  autonomy: "suggest",
  categories: ["newsletter"],
  protectedCategories: ["personal"],
  confidence: 0.95,
  userConfirmed: true,
};

export function item(
  n: number,
  kind: Command["kind"],
  authorization: ApplyActionItem["authorization"] = confirmed,
  key = `key-${n}`,
): ApplyActionItem {
  const action: Action = {
    schemaVersion: 1,
    id: unwrap(ActionId(`act_${n}`)),
    workspaceId: ws,
    idempotencyKey: key,
    command: { kind, messageIds: [unwrap(MessageId(`m${n}`))] },
    createdAt: "2026-11-17T10:00:00.000Z",
  };
  return { action, authorization };
}
