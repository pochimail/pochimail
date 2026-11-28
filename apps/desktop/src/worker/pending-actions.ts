import type { Account } from "@pochimail/accounts/model/account";
import type { ActionLog } from "@pochimail/actions/model/action";
import { ResolvePendingActions } from "@pochimail/actions/use-cases/resolve-pending-actions";
import type { Clock } from "@pochimail/kernel/clock";
import { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import type { MailProvider } from "@pochimail/workflows/ports/mail-provider";
import type { WorkflowUnitOfWork } from "@pochimail/workflows/ports/unit-of-work";
import { accountOfEntry } from "./account-of-entry.ts";

/** The slice of the worker's adapters recovery needs. */
export interface PendingActionsDeps {
  readonly workspaceId: WorkspaceId;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly uow: WorkflowUnitOfWork;
  readonly providerFor: (account: Account) => MailProvider;
}

/**
 * Run at start: settles the actions a crash left `pending`, so each shows in Activity and can be
 * undone. Only entries older than the start are touched, so an action running while recovery is
 * still going is never replayed. The entry's provider is the one of the account that owns its messages.
 * Never rejects: a failure is logged and the entries stay pending for the next start.
 */
export async function resolvePendingActions(adapters: PendingActionsDeps): Promise<void> {
  const { uow, workspaceId } = adapters;
  const bootedAt = adapters.clock.now().toISOString();
  const resolver = new ResolvePendingActions({
    uow,
    clock: adapters.clock,
    ids: { next: (prefix) => `${prefix}_${crypto.randomUUID()}` },
    providerFor: async (entry: ActionLog) => {
      const account = await accountOfEntry(uow, workspaceId, entry);
      if (account === undefined) return err(new NotFound("Message"));
      try {
        return ok(adapters.providerFor(account));
      } catch {
        return err(new StorageError("No provider for the account"));
      }
    },
  });
  try {
    const report = await resolver.execute(workspaceId, bootedAt, new AbortController().signal);
    if (!report.ok)
      adapters.logger.error("pending actions not resolved", { code: report.error.code });
  } catch {
    adapters.logger.error("pending actions not resolved", { code: "storage.failed" });
  }
}
