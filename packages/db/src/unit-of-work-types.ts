import type {
  AccountsTransaction,
  AccountsUnitOfWork,
} from "@pochimail/accounts/ports/unit-of-work";
import type { ActionsTransaction, ActionsUnitOfWork } from "@pochimail/actions/ports/unit-of-work";
import type {
  ClassificationTransaction,
  ClassificationUnitOfWork,
} from "@pochimail/classification/ports/unit-of-work";
import type { KeepRuleRepository } from "@pochimail/cleanup/ports/keep-rule-repository";
import type { CleanupTransaction, CleanupUnitOfWork } from "@pochimail/cleanup/ports/unit-of-work";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { Cancelled, StorageError } from "@pochimail/kernel/errors";
import type { EventSink } from "@pochimail/kernel/event-sink";
import type { Result } from "@pochimail/kernel/result";
import type { MailboxTransaction, MailboxUnitOfWork } from "@pochimail/mailbox/ports/unit-of-work";
import type { OutboxEntry } from "@pochimail/pipeline/outbox";

/** Every domain's repositories, so one SQLite transaction commits them together with the outbox (ADR 0003). */
export type WriteRepositories = AccountsTransaction["repositories"] &
  MailboxTransaction["repositories"] &
  ClassificationTransaction["repositories"] &
  CleanupTransaction["repositories"] &
  ActionsTransaction["repositories"];

export type ReadRepositories = AccountsUnitOfWork["reads"] &
  MailboxUnitOfWork["reads"] &
  ClassificationUnitOfWork["reads"] &
  CleanupUnitOfWork["reads"] &
  ActionsUnitOfWork["reads"];

export interface Transaction {
  readonly repositories: WriteRepositories;
  /** Protection rules keyed by a hashed sender (ADR 0012, 0014). */
  readonly keepRules: KeepRuleRepository;
  readonly outbox: { append(entry: OutboxEntry): AsyncResult<void, StorageError> };
  readonly events: EventSink;
}

export interface UnitOfWork {
  readonly reads: ReadRepositories;
  run<T, E>(
    work: (tx: Transaction) => Promise<Result<T, E>>,
    signal?: CancelSignal,
  ): AsyncResult<T, E | StorageError | Cancelled>;
}
