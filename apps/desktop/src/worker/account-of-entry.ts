import type { Account } from "@pochimail/accounts/model/account";
import type { ActionLog } from "@pochimail/actions/model/action";
import { MessageId, type WorkspaceId } from "@pochimail/kernel/ids";
import type { WorkflowUnitOfWork } from "@pochimail/workflows/ports/unit-of-work";

/**
 * The account that owns an action's messages, or `undefined` once the account was removed (its entries
 * then carry placeholder ids and no message resolves).
 */
export async function accountOfEntry(
  uow: WorkflowUnitOfWork,
  workspaceId: WorkspaceId,
  entry: ActionLog,
): Promise<Account | undefined> {
  const raw = entry.command.messageIds[0];
  const id = raw === undefined ? undefined : MessageId(raw);
  if (id === undefined || !id.ok) return undefined;
  const message = await uow.reads.messages.get(workspaceId, id.value);
  if (!message.ok) return undefined;
  const account = await uow.reads.accounts.get(workspaceId, message.value.accountId);
  return account.ok ? account.value : undefined;
}
