import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { EMAIL_TYPES, type EmailType } from "../model/email-type.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";

/** Counts only: emails per type for the selected accounts, from one aggregate read (the sidebar's numbers). */
export class CountTypes {
  constructor(private readonly deps: { readonly uow: ClassificationUnitOfWork }) {}

  async execute(
    workspaceId: WorkspaceId,
    accountIds: readonly AccountId[],
  ): AsyncResult<Readonly<Record<EmailType, number>>, StorageError> {
    const counted = await this.deps.uow.reads.messages.countByCategory(workspaceId, accountIds);
    if (!counted.ok) return counted;
    return ok(
      Object.fromEntries(EMAIL_TYPES.map((c) => [c, counted.value[c] ?? 0])) as Record<
        EmailType,
        number
      >,
    );
  }
}
