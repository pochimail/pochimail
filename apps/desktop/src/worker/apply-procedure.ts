import { createHash } from "node:crypto";
import type { Account } from "@pochimail/accounts/model/account";
import { ActionId } from "@pochimail/actions/ids";
import type { Action } from "@pochimail/actions/model/action";
import { ApplyAction } from "@pochimail/actions/use-cases/apply-action";
import type { EmailType } from "@pochimail/classification/model/email-type";
import { PROTECTING_SIGNALS } from "@pochimail/cleanup/policies/labels";
import type { Clock } from "@pochimail/kernel/clock";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { AccountId, MessageId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import type { WorkflowUnitOfWork } from "@pochimail/workflows/ports/unit-of-work";
import type { InputOf, OutputOf } from "../shared/ipc/contract.ts";
import type { AppSettings } from "../shared/settings.ts";

export interface ApplyProcedureDeps {
  readonly workspaceId: WorkspaceId;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly uow: WorkflowUnitOfWork;
  readonly providerFor: (account: Account) => MailProvider;
  readonly autonomy: () => Promise<AppSettings["autonomy"]>;
}

/** People mail is never touched by a clean-up, even with the person's approval (ADR 0012). */
const PROTECTED_CATEGORIES: readonly EmailType[] = ["personal"];

const unwrapOrThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

/**
 * One idempotency key per (account, kind, messages): a double click reaches the provider once. A key whose
 * action was undone is spent (ApplyAction never re-runs it), so applying the same messages again takes the next one.
 */
async function idempotencyKey(
  deps: ApplyProcedureDeps,
  accountId: string,
  kind: string,
  messageIds: readonly MessageId[],
): Promise<string> {
  const digest = createHash("sha256")
    .update([...messageIds].sort().join(","))
    .digest("hex");
  for (let round = 0; ; round += 1) {
    const key = `cleanup:${accountId}:${kind}:${digest}:${round}`;
    const entries = unwrapOrThrow(await deps.uow.reads.actionLog.listForKey(deps.workspaceId, key));
    if (!entries.some((entry) => entry.outcome === "undone")) return key;
  }
}

/**
 * `cleanup.apply`: reads each message's category, signals and confidence from the store (never from the
 * renderer), drops what is protected or not this account's, and runs the rest as one action.
 */
export function createApplyProcedure(deps: ApplyProcedureDeps) {
  const { uow, workspaceId } = deps;
  // One instance per account keeps ApplyAction's in-flight map, so a double click shares one attempt.
  const appliers = new Map<string, ApplyAction>();
  const applierFor = (account: Account): ApplyAction => {
    let applier = appliers.get(account.id);
    if (applier === undefined) {
      applier = new ApplyAction({
        uow,
        provider: deps.providerFor(account),
        clock: deps.clock,
        ids: deps.ids,
      });
      appliers.set(account.id, applier);
    }
    return applier;
  };

  /** Keeps the messages of this account that no protection stops; the rest are counted as refused. */
  const vet = async (accountId: AccountId, requested: readonly string[]) => {
    const ids: MessageId[] = [];
    const categories = new Set<string>();
    let refused = 0;
    for (const raw of new Set(requested)) {
      const id = MessageId(raw);
      const message = id.ok ? await uow.reads.messages.get(workspaceId, id.value) : undefined;
      const mine = message?.ok === true && message.value.accountId === accountId;
      if (!mine || PROTECTED_CATEGORIES.some((c) => c === message.value.category)) {
        refused += 1;
        continue;
      }
      ids.push(message.value.id);
      categories.add(message.value.category);
    }
    const signals = unwrapOrThrow(
      await uow.reads.mailboxFacts.signals(workspaceId, accountId, ids, deps.clock.now()),
    );
    const guarded = new Set(
      signals.filter((s) => PROTECTING_SIGNALS.includes(s.kind)).map((s) => s.messageId),
    );
    const allowed = ids.filter((id) => !guarded.has(id));
    return { allowed, categories: [...categories], refused: refused + ids.length - allowed.length };
  };

  /** Messages of a failed action that were applied before it failed keep their undo and count as applied. */
  const appliedBeforeFailure = async (key: string): Promise<number> => {
    const entries = unwrapOrThrow(await uow.reads.actionLog.listForKey(workspaceId, key));
    return entries
      .filter((entry) => entry.outcome === "applied")
      .reduce((sum, entry) => sum + entry.command.messageIds.length, 0);
  };

  return async (input: InputOf<"cleanup.apply">): Promise<OutputOf<"cleanup.apply">> => {
    const accountId = unwrapOrThrow(AccountId(input.accountId));
    const account = unwrapOrThrow(await uow.reads.accounts.get(workspaceId, accountId));
    const { allowed, categories, refused } = await vet(accountId, input.messageIds);
    const batchId = `batch_${crypto.randomUUID()}`;
    if (allowed.length === 0) return { batchId, applied: 0, refused, failed: 0 };

    const decisions = unwrapOrThrow(await uow.reads.mailboxFacts.decisions(workspaceId, allowed));
    const confidence =
      decisions.length < allowed.length ? 0 : Math.min(...decisions.map((d) => d.confidence));
    const action: Action = {
      schemaVersion: 1,
      id: unwrap(ActionId(deps.ids.next("act"))),
      workspaceId,
      ...(input.suggestionId === undefined ? {} : { suggestionId: input.suggestionId }),
      idempotencyKey: await idempotencyKey(deps, accountId, input.kind, allowed),
      command: { kind: input.kind, messageIds: allowed },
      createdAt: deps.clock.now().toISOString(),
    };
    const authorization = {
      autonomy: await deps.autonomy(),
      categories,
      protectedCategories: PROTECTED_CATEGORIES,
      confidence,
      userConfirmed: input.confirmed,
    };
    const report = await applierFor(account).execute(
      { batchId, items: [{ action, authorization }] },
      new AbortController().signal,
    );
    const outcome = report.outcomes[0];
    if (outcome === undefined || outcome.status === "failed") {
      const applied = await appliedBeforeFailure(action.idempotencyKey);
      return { batchId, applied, refused, failed: allowed.length - applied };
    }
    if (outcome.status === "refused")
      return { batchId, applied: 0, refused: refused + allowed.length, failed: 0 };
    // An action that was already applied answers with its own batch, so the screen undoes the right one.
    const first = unwrapOrThrow(await uow.reads.actionLog.get(workspaceId, outcome.logId));
    return { batchId: first.batchId ?? batchId, applied: allowed.length, refused, failed: 0 };
  };
}
