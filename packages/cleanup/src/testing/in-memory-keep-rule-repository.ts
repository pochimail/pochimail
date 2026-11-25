import { ok } from "@pochimail/kernel/result";
import type { KeepRule } from "../model/keep-rule.ts";
import type { KeepRuleRepository } from "../ports/keep-rule-repository.ts";

/** In-memory implementation of the keep-rule port, for contract tests and domain fixtures. */
export function createInMemoryKeepRuleRepository(): KeepRuleRepository {
  const rows = new Map<string, KeepRule>();
  const key = (r: KeepRule) => `${r.workspaceId}/${r.accountId}/${r.senderHash}/${r.ruleType}`;
  const byRuleType = (a: KeepRule, b: KeepRule) => {
    if (a.ruleType === b.ruleType) return 0;
    return a.ruleType < b.ruleType ? -1 : 1;
  };
  return {
    list: async (ws, accountId, senderHash) =>
      ok(
        [...rows.values()]
          .filter(
            (r) => r.workspaceId === ws && r.accountId === accountId && r.senderHash === senderHash,
          )
          .sort(byRuleType),
      ),
    save: async (rule) => {
      rows.set(key(rule), rule);
      return ok(undefined);
    },
  };
}
