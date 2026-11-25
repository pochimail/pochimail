import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import type { KeepRule } from "../model/keep-rule.ts";

/** Protection rules keyed by a hashed sender, never by an address (ADR 0012, 0014). */
export interface KeepRuleRepository {
  list(
    ws: WorkspaceId,
    accountId: AccountId,
    senderHash: string,
  ): AsyncResult<readonly KeepRule[], StorageError>;
  save(rule: KeepRule): AsyncResult<void, StorageError>;
}
