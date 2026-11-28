import type { Account } from "@pochimail/accounts/model/account";
import { ActionId } from "@pochimail/actions/ids";
import { UndoAction, type UndoOutcome } from "@pochimail/actions/use-cases/undo-action";
import type { ProposeSuggestions } from "@pochimail/cleanup/use-cases/propose-suggestions";
import type { Clock } from "@pochimail/kernel/clock";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import { AccountId, type WorkspaceId } from "@pochimail/kernel/ids";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import type { WorkflowUnitOfWork } from "@pochimail/workflows/ports/unit-of-work";
import type { OutputOf } from "../shared/ipc/contract.ts";
import type { Handlers } from "../shared/ipc/server.ts";
import type { AppSettings } from "../shared/settings.ts";
import { accountOfEntry } from "./account-of-entry.ts";
import { createApplyProcedure } from "./apply-procedure.ts";

export interface CleanupProcedureDeps {
  readonly workspaceId: WorkspaceId;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly uow: WorkflowUnitOfWork;
  readonly propose: ProposeSuggestions;
  readonly providerFor: (account: Account) => MailProvider;
  /** The autonomy the person chose, read when an action is applied, never taken from the renderer. */
  readonly autonomy: () => Promise<AppSettings["autonomy"]>;
  /** Delivers the events the action just committed (ActionApplied, ActionFailed, ActionUndone) to the screens. */
  readonly flush: () => Promise<void>;
}

type Procedures = Handlers["procedures"];
type Undo = OutputOf<"cleanup.undo">;

const COUNT_KEY: Record<UndoOutcome["status"], keyof Undo> = {
  undone: "undone",
  "already-undone": "alreadyUndone",
  irreversible: "irreversible",
  "not-applied": "notApplied",
  failed: "failed",
};

const unwrapOrThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

/** The cleanup answers (#270): thin parsing, one use case each, answers with ids, enums and counts only. */
export function createCleanupProcedures(deps: CleanupProcedureDeps): Procedures {
  const { uow, workspaceId } = deps;
  const apply = createApplyProcedure(deps);
  return {
    "cleanup.suggestions": async ({ accountIds }) => {
      const out: OutputOf<"cleanup.suggestions"> = [];
      let cursor: string | undefined;
      do {
        const page = unwrapOrThrow(
          await uow.reads.suggestions.listPending(workspaceId, {
            limit: 200,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        );
        for (const s of page.items) {
          if (accountIds !== undefined && !accountIds.includes(s.accountId)) continue;
          out.push({
            id: s.id,
            accountId: s.accountId,
            kind: s.recommendation.kind,
            messageCount: s.recommendation.messageIds.length,
            confidence: s.confidence,
            reasons: s.reasons,
          });
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return out;
    },
    "cleanup.propose": async ({ accountId }) => {
      const created = unwrapOrThrow(
        await deps.propose.execute(
          { workspaceId, accountId: unwrapOrThrow(AccountId(accountId)) },
          new AbortController().signal,
        ),
      );
      return { created: created.length };
    },
    "cleanup.apply": async (input) => {
      try {
        return await apply(input);
      } finally {
        await deps.flush();
      }
    },
    "cleanup.undo": async (input) => {
      const target =
        "batchId" in input
          ? { workspaceId, batchId: input.batchId }
          : { workspaceId, actionId: unwrapOrThrow(ActionId(input.actionId)) };
      const logs = unwrapOrThrow(
        "batchId" in target
          ? await uow.reads.actionLog.listForBatch(workspaceId, target.batchId)
          : await uow.reads.actionLog.listForAction(workspaceId, target.actionId),
      );
      const counts: Undo = {
        undone: 0,
        alreadyUndone: 0,
        irreversible: 0,
        notApplied: 0,
        failed: 0,
      };
      const first = logs[0];
      if (first === undefined) return counts;
      // An entry of a removed account has no message to reach the provider with: nothing is undone.
      const account = await accountOfEntry(uow, workspaceId, first);
      if (account === undefined) {
        counts.failed = new Set(logs.map((entry) => entry.actionId)).size;
        return counts;
      }
      const undo = new UndoAction({
        uow,
        provider: deps.providerFor(account),
        clock: deps.clock,
        ids: deps.ids,
      });
      const done = await undo.execute(target, new AbortController().signal);
      await deps.flush();
      const report = unwrapOrThrow(done);
      for (const outcome of report.outcomes) counts[COUNT_KEY[outcome.status]] += 1;
      return counts;
    },
  };
}
