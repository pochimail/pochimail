import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import type { Result } from "@pochimail/kernel/result";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import type { PolicyDenied } from "../errors.ts";
import { ACTION_KINDS, type Command } from "../model/action.ts";
import type { Authorization, AuthorizationContext } from "../policies/authorize.ts";
import {
  AUTONOMY_LEVELS,
  AUTOPILOT_CONFIDENCE_THRESHOLD,
  type AutonomyLevel,
} from "../policies/autonomy.ts";

type Authorize = (
  command: Command,
  ctx: AuthorizationContext,
) => Result<Authorization, PolicyDenied>;

const workspaceId = unwrap(WorkspaceId("w-1"));
const AUTOPILOT_KINDS: readonly string[] = ["archive", "unsubscribe"];
const CONFIDENCES = [
  0,
  0.5,
  AUTOPILOT_CONFIDENCE_THRESHOLD - 0.001,
  AUTOPILOT_CONFIDENCE_THRESHOLD,
  1,
];
const cmd = (kind: string): Command => ({
  kind: kind as Command["kind"], // "delete" is deliberately outside the type: a runtime-only probe
  messageIds: [unwrap(MessageId("m-1"))],
});

/** The labels the contract runs over: every category the composition knows, and which are protected. */
export interface PolicyLabels {
  readonly categories: readonly string[];
  readonly protectedCategories: readonly string[];
}

const BOOLS = [true, false] as const;
/** Every combination of the lists, so a contract loops once instead of four levels deep. */
const product = <A, B, C, D>(a: readonly A[], b: readonly B[], c: readonly C[], d: readonly D[]) =>
  a.flatMap((x) => b.flatMap((y) => c.flatMap((z) => d.map((w): [A, B, C, D] => [x, y, z, w]))));

const contextWith =
  (protectedCategories: readonly string[]) =>
  (
    autonomy: AutonomyLevel,
    category: string,
    confidence: number,
    userConfirmed: boolean,
  ): AuthorizationContext => ({
    workspaceId,
    autonomy,
    categories: [category],
    protectedCategories,
    confidence,
    userConfirmed,
  });

/** Contract for any `authorize` implementation: the safety matrix, table-driven. */
export function authorizeContract(authorize: Authorize, labels: PolicyLabels): void {
  const { categories: CATEGORIES, protectedCategories } = labels;
  const protectedLabel = protectedCategories[0] ?? "people";
  const ctx = contextWith(protectedCategories);
  const allowed = (kind: string, c: AuthorizationContext) => authorize(cmd(kind), c).ok;

  describe("authorize contract", () => {
    it("never authorizes a delete under any policy, category, confidence or confirmation", () => {
      for (const [a, cat, conf, confirmed] of product(
        AUTONOMY_LEVELS,
        CATEGORIES,
        CONFIDENCES,
        BOOLS,
      ))
        expect(allowed("delete", ctx(a, cat, conf, confirmed))).toBe(false);
    });

    it("just-look never permits a mutation, even one the user confirmed", () => {
      for (const [kind, cat, conf, confirmed] of product(
        ACTION_KINDS,
        CATEGORIES,
        CONFIDENCES,
        BOOLS,
      ))
        expect(allowed(kind, ctx("just-look", cat, conf, confirmed))).toBe(false);
    });

    it("suggest never applies anything without explicit user confirmation", () => {
      for (const kind of ACTION_KINDS)
        for (const cat of CATEGORIES)
          for (const conf of CONFIDENCES) {
            expect(allowed(kind, ctx("suggest", cat, conf, false))).toBe(false);
            expect(allowed(kind, ctx("suggest", cat, conf, true))).toBe(true);
          }
    });

    it("autopilot never auto-actions People mail, however confident", () => {
      for (const kind of ACTION_KINDS)
        for (const conf of CONFIDENCES)
          for (const label of protectedCategories)
            expect(allowed(kind, ctx("autopilot", label, conf, false))).toBe(false);
    });

    it("autopilot never auto-actions a batch that includes any People message", () => {
      const mixed = {
        ...ctx("autopilot", "promotions", 1, false),
        categories: ["promotions", protectedLabel],
      };
      expect(allowed("archive", mixed)).toBe(false);
      expect(authorize(cmd("archive"), mixed).ok).toBe(false);
      const unknown = authorize(cmd("archive"), { ...mixed, categories: [] });
      expect(!unknown.ok && unknown.error.reason).toBe("unknown-category");
    });

    it("autopilot applies eligible kinds only at or above the threshold, never below", () => {
      for (const cat of CATEGORIES.filter((c) => !protectedCategories.includes(c)))
        for (const kind of AUTOPILOT_KINDS)
          for (const conf of CONFIDENCES)
            expect(allowed(kind, ctx("autopilot", cat, conf, false))).toBe(
              conf >= AUTOPILOT_CONFIDENCE_THRESHOLD,
            );
    });

    it("autopilot refuses an unsure or undecided answer at any threshold (ADR 0012)", () => {
      for (const cat of CATEGORIES)
        for (const conf of [0, UNSURE_BELOW - 0.01, Number.NaN]) {
          const denied = authorize(cmd("archive"), ctx("autopilot", cat, conf, false));
          expect(!denied.ok && denied.error.reason).toBe("unsure-category");
        }
    });

    it("autopilot treats a NaN confidence as below threshold", () => {
      expect(allowed("archive", ctx("autopilot", "promotions", Number.NaN, false))).toBe(false);
    });

    it("autopilot does not auto-apply undo or bookkeeping kinds", () => {
      for (const kind of ACTION_KINDS.filter((k) => !AUTOPILOT_KINDS.includes(k)))
        expect(allowed(kind, ctx("autopilot", "promotions", 1, false))).toBe(false);
    });

    it("an explicitly confirmed action in autopilot is allowed, People included", () => {
      expect(allowed("archive", ctx("autopilot", protectedLabel, 0, true))).toBe(true);
    });
  });
}
