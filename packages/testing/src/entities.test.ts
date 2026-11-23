import { accountSchema } from "@pochimail/accounts/model/account";
import { actionLogSchema, actionSchema } from "@pochimail/actions/model/action";
import {
  CATEGORIES,
  categoryOf,
  categorySchema,
  signalKindSchema,
} from "@pochimail/classification/model/category";
import { incomingMessageSchema, messageSchema } from "@pochimail/mailbox/model/message";
import { describe, expect, it } from "vitest";
import { rng, sampleBuilders } from "./domain-samples.ts";
import { entityRoundTripContract } from "./entity-contract.ts";

entityRoundTripContract();

const r = rng(42);

describe("fixed vocabularies", () => {
  it("has exactly the 7 brief categories (a renamed or extra category breaks the sidebar)", () => {
    expect([...CATEGORIES].sort()).toEqual(
      [
        "newsletters",
        "notifications",
        "people",
        "promotions",
        "purchases-travel",
        "records",
        "sign-ins-security",
      ].sort(),
    );
  });
  it("rejects an unknown category on a message (including 'suspicious', which is a flag)", () => {
    expect(categorySchema.safeParse("suspicious").success).toBe(false);
    const m = { ...sampleBuilders.message(r), category: "spam" };
    expect(() => categoryOf(m)).toThrow();
  });
  it("has exactly 6 signal kinds", () => {
    expect(signalKindSchema.options).toHaveLength(6);
  });
});

describe("Account", () => {
  it("rejects an account without workspaceId (breaks the single authorization policy)", () => {
    const { workspaceId: _omit, ...rest } = sampleBuilders.account(r);
    expect(accountSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects an unknown provider kind", () => {
    expect(
      accountSchema.safeParse({ ...sampleBuilders.account(r), provider: "yahoo" }).success,
    ).toBe(false);
  });
});

describe("Message", () => {
  it("rejects a classified message without a category (every message has exactly one)", () => {
    const { category: _omit, ...rest } = sampleBuilders.message(r);
    expect(messageSchema.safeParse(rest).success).toBe(false);
  });
  it("accepts an unclassified message only as IncomingMessage (pre-classification state)", () => {
    const incoming = sampleBuilders.incomingMessage(r);
    expect(incomingMessageSchema.safeParse(incoming).success).toBe(true);
    expect(messageSchema.safeParse(incoming).success).toBe(false);
  });
});

describe("Action and ActionLog", () => {
  it("has no delete command (delete means move to Trash, ADR 0012)", () => {
    const a = sampleBuilders.action(r);
    expect(
      actionSchema.safeParse({ ...a, command: { kind: "delete", messageIds: ["m-1"] } }).success,
    ).toBe(false);
  });
  const applied = (over: object) => ({
    ...sampleBuilders.actionLog(r),
    outcome: "applied",
    errorCode: undefined,
    irreversibleReason: undefined,
    ...over,
  });
  const archive = { kind: "archive", messageIds: ["m-1"] };
  const unarchive = { kind: "unarchive", messageIds: ["m-1"] };
  it("rejects an applied archive logged without an inverse (undo would be impossible)", () => {
    const log = applied({ command: archive, inverse: null, irreversible: false });
    expect(actionLogSchema.safeParse(log).success).toBe(false);
  });
  it("rejects marking a non-unsubscribe action irreversible (a loophole around undo)", () => {
    const log = applied({
      command: archive,
      inverse: null,
      irreversible: true,
      irreversibleReason: "x",
    });
    expect(actionLogSchema.safeParse(log).success).toBe(false);
  });
  it("accepts an unsubscribe logged as irreversible with a reason", () => {
    const command = { kind: "unsubscribe", messageIds: ["m-1"] };
    const log = applied({
      command,
      inverse: null,
      irreversible: true,
      irreversibleReason: "cannot be recalled",
    });
    expect(actionLogSchema.safeParse(log).success).toBe(true);
  });
  it("rejects an irreversible unsubscribe without a reason (the UI could not explain it)", () => {
    const command = { kind: "unsubscribe", messageIds: ["m-1"] };
    const log = applied({ command, inverse: null, irreversible: true });
    expect(actionLogSchema.safeParse(log).success).toBe(false);
  });
  it("accepts an applied archive that records its inverse", () => {
    const log = applied({ command: archive, inverse: unarchive, irreversible: false });
    expect(actionLogSchema.safeParse(log).success).toBe(true);
  });
});

describe("persisted entities", () => {
  it("rejects a future schemaVersion (stale rows must be migrated, not guessed)", () => {
    const m = sampleBuilders.message(r);
    expect(messageSchema.safeParse({ ...m, schemaVersion: 2 }).success).toBe(false);
  });
  it("rejects a missing schemaVersion (an unversioned row cannot be migrated)", () => {
    const { schemaVersion: _omit, ...rest } = sampleBuilders.message(r);
    expect(messageSchema.safeParse(rest).success).toBe(false);
  });
});
