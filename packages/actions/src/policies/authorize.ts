import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { type PolicyDenialReason, PolicyDenied } from "../errors.ts";
import type { Command } from "../model/action.ts";
import {
  AUTOPILOT_CONFIDENCE_THRESHOLD,
  AUTOPILOT_ELIGIBLE,
  type AutonomyLevel,
  isActionKind,
} from "./autonomy.ts";

/** What the caller knows about the action it wants to run. */
export interface AuthorizationContext {
  readonly workspaceId: WorkspaceId;
  readonly autonomy: AutonomyLevel;
  /** Category of every message the command touches; the labels are classification's. */
  readonly categories: readonly string[];
  /** Categories whose mail is never touched without explicit approval (brief §2 invariants); the composition names them. */
  readonly protectedCategories: readonly string[];
  readonly confidence: number;
  /** True only when the user explicitly approved this exact action. */
  readonly userConfirmed: boolean;
}

/** `auto`: Autopilot applies it unprompted. `confirmed`: the user approved it. */
export type Authorization = { readonly mode: "auto" | "confirmed" };

const deny = (reason: PolicyDenialReason) => err(new PolicyDenied(reason));
const hasProtected = (ctx: AuthorizationContext) =>
  ctx.categories.some((c) => ctx.protectedCategories.includes(c));

function autopilotRules(
  command: Command,
  ctx: AuthorizationContext,
): Result<Authorization, PolicyDenied> {
  // No categories means we cannot prove the mail is not People: refuse.
  if (ctx.categories.length === 0) return deny("unknown-category");
  // ADR 0012: an unsure or undecided answer is protected, at any autopilot threshold.
  if (!(ctx.confidence >= UNSURE_BELOW)) return deny("unsure-category");
  if (hasProtected(ctx)) return deny("protected-category");
  if (!AUTOPILOT_ELIGIBLE[command.kind]) return deny("not-autopilot-eligible");
  // `>=` is false for NaN, so a missing score never passes.
  if (!(ctx.confidence >= AUTOPILOT_CONFIDENCE_THRESHOLD))
    return deny("below-confidence-threshold");
  return ok({ mode: "auto" });
}

function autonomyRules(
  command: Command,
  ctx: AuthorizationContext,
): Result<Authorization, PolicyDenied> {
  // Runtime guard: a kind outside the closed set (e.g. "delete") is never allowed.
  if (!isActionKind(command.kind)) return deny("unknown-action-kind");

  switch (ctx.autonomy) {
    case "just-look":
      return deny("read-only");
    case "suggest":
      return ctx.userConfirmed ? ok({ mode: "confirmed" }) : deny("needs-confirmation");
    case "autopilot":
      return ctx.userConfirmed ? ok({ mode: "confirmed" }) : autopilotRules(command, ctx);
    default: {
      const unreachable: never = ctx.autonomy;
      return unreachable;
    }
  }
}

/** v1 has a single local user, so the principal check always allows. Seam for teams later (brief §5.6). */
function principalMayAct(_ctx: AuthorizationContext): boolean {
  return true;
}

/**
 * The single call-site every action passes through (brief §5.6). Invariants first, then the
 * autonomy level, then the principal check. Pure: no I/O, no clock.
 */
export function authorize(
  command: Command,
  ctx: AuthorizationContext,
): Result<Authorization, PolicyDenied> {
  const decision = autonomyRules(command, ctx);
  if (!decision.ok) return decision;
  return principalMayAct(ctx) ? decision : deny("needs-confirmation");
}
