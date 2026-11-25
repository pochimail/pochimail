import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import type { KeepRule } from "../model/keep-rule.ts";
import type { KeepRuleRepository } from "../ports/keep-rule-repository.ts";
import { ACCOUNT_1, WS_A, WS_B } from "./samples.ts";

const hash = (n: number) => String(n).repeat(64);
const rule = (
  senderHash: string,
  ruleType: KeepRule["ruleType"],
  workspaceId = WS_A,
): KeepRule => ({
  schemaVersion: 1,
  workspaceId,
  accountId: ACCOUNT_1,
  senderHash,
  ruleType,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const checks: readonly Check<KeepRuleRepository>[] = [
  check(
    "keep rules round-trip by sender hash and stay in their workspace (guards a protection rule leaking to another sender or workspace)",
    async (repo) => {
      unwrap(await repo.save(rule(hash(1), "vip")));
      unwrap(await repo.save(rule(hash(2), "manual")));
      unwrap(await repo.save(rule(hash(1), "manual")));
      unwrap(await repo.save(rule(hash(1), "vip", WS_B)));
      expect(unwrap(await repo.list(WS_A, ACCOUNT_1, hash(1))).map((r) => r.ruleType)).toEqual([
        "manual",
        "vip",
      ]);
      expect(unwrap(await repo.list(WS_B, ACCOUNT_1, hash(1))).map((r) => r.ruleType)).toEqual([
        "vip",
      ]);
      expect(unwrap(await repo.list(WS_A, ACCOUNT_1, hash(2)))).toEqual([rule(hash(2), "manual")]);
    },
  ),
];

/** The same behaviour for every keep-rule adapter. */
export function keepRuleRepositoryContract(make: () => KeepRuleRepository): void {
  registerContract("Keep rule repository", checks, () => Promise.resolve(make()));
}
