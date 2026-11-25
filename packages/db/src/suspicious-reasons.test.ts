import { SUSPICIOUS_REASONS } from "@pochimail/classification/policies/suspicious-rules";
import { ok, unwrap } from "@pochimail/kernel/result";
import { makeIncomingMessage, WS_A } from "@pochimail/testing/fixtures";
import { describe, expect, it } from "vitest";
import { createSqliteUnitOfWork } from "./sqlite-unit-of-work.ts";
import { freshPath, key, open } from "./test-support/storage.ts";

const connect = (path: string) => {
  const storage = open(path, key(3));
  return { storage, ...createSqliteUnitOfWork(storage) };
};
const store = async (c: ReturnType<typeof connect>, reasons: string[]) => {
  const stored = await c.uow.run(async (tx) => {
    unwrap(
      await tx.repositories.messages.upsertMany([
        makeIncomingMessage(1, { suspicious: { reasons, confidence: 0.8 } }),
      ]),
    );
    return ok(undefined);
  });
  expect(stored.ok).toBe(true);
};

describe("stored suspicious reasons", () => {
  // Guards: the reason codes being hashed, so a stored flag can no longer be explained after a restart.
  it("come back as the original code strings after a restart", async () => {
    const path = freshPath();
    const reasons = [SUSPICIOUS_REASONS.punycode, SUSPICIOUS_REASONS.lookalike];
    await store(connect(path), reasons);
    const restarted = connect(path);
    const message = unwrap(await restarted.uow.reads.messages.get(WS_A, "msg-1" as never));
    expect(message.suspicious).toEqual({ reasons, confidence: 0.8 });
  });

  // Guards: a free-text reason from a provider being stored as it is (ADR 0014).
  it("keep only the fixed codes: any other text is stored as `other`", async () => {
    const path = freshPath();
    const c = connect(path);
    await store(c, ["Your account is locked, click here"]);
    const row = c.storage.reader
      .prepare("SELECT suspicious_reason_code AS code FROM message")
      .get();
    expect(row).toEqual({ code: "other" });
  });
});
