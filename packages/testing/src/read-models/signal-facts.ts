import type { Account } from "@pochimail/accounts/model/account";
import type { AccountReader } from "@pochimail/accounts/ports/account-repository";
import type { SignalFacts } from "@pochimail/classification/model/message-facts";
import type { SignalFactsSource } from "@pochimail/classification/ports/message-source";
import type { AsyncResult } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import type { Message } from "@pochimail/mailbox/model/message";
import type { MessageReader } from "@pochimail/mailbox/ports/message-repository";
import type { SenderReader } from "@pochimail/mailbox/ports/sender-repository";
import type { ThreadReader } from "@pochimail/mailbox/ports/thread-repository";

export interface SignalFactsReads {
  readonly accounts: AccountReader;
  readonly messages: MessageReader;
  readonly threads: ThreadReader;
  readonly senders: SenderReader;
}
type Reads = SignalFactsReads;

/** Threads are optional context: a message without a stored thread is a thread of one. */
async function endsThread(
  reads: Reads,
  ws: WorkspaceId,
  message: Message,
): AsyncResult<boolean, StorageError> {
  const thread = await reads.threads.get(ws, message.threadId);
  if (thread.ok) return ok(thread.value.messageIds.at(-1) === message.id);
  if (thread.error.code === "storage.not_found") return ok(true);
  return err(thread.error);
}

async function factsOf(
  reads: Reads,
  ws: WorkspaceId,
  owner: Account,
  message: Message,
): AsyncResult<SignalFacts, StorageError | NotFound> {
  const sender = await reads.senders.ofMessage(ws, message.id, owner.address);
  if (!sender.ok) return sender;
  const last = await endsThread(reads, ws, message);
  if (!last.ok) return last;
  return ok({
    messageId: message.id,
    fromOwner: sender.value.fromOwner,
    ...(message.suspicious === undefined ? {} : { suspicious: message.suspicious }),
    storedCategory: message.category,
    receivedAt: message.receivedAt,
    opened: message.opened,
    lastInThread: last.value,
    senderVip: sender.value.stats?.vip ?? false,
    senderRepliedCount: sender.value.stats?.repliedCount ?? 0,
    hasListUnsubscribe: message.hasListUnsubscribe,
    ...(message.savedCount === undefined ? {} : { attachmentCount: message.savedCount }),
  });
}

/**
 * Classification's plain-data view of a message, read from
 * the accounts, mailbox and sender rows. Built from the stored rows; the in-memory test store builds the same view.
 */
export function signalFactsOver(reads: Reads): SignalFactsSource {
  return {
    async forMessages(ws, accountId, ids: readonly MessageId[]) {
      const account = await reads.accounts.get(ws, accountId);
      if (!account.ok) return account;
      const out: SignalFacts[] = [];
      for (const id of ids) {
        const message = await reads.messages.get(ws, id);
        if (!message.ok) return message;
        if (message.value.accountId !== accountId) continue;
        const facts = await factsOf(reads, ws, account.value, message.value);
        if (!facts.ok) return facts;
        out.push(facts.value);
      }
      return ok(out);
    },
  };
}
