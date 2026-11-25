// Guards: phishing missed once the address is dropped from storage, and a provider flag overwritten.
import { makeIncoming } from "@pochimail/mailbox/testing/mailbox-repository-contract";
import { describe, expect, it } from "vitest";
import { flagSuspicious } from "./flag-suspicious.ts";

describe("flagSuspicious", () => {
  it("stores the domain flag of a lookalike sender and leaves a normal one and a provider flag alone", () => {
    const lookalike = makeIncoming(1, { from: "a@id-examp1e-verify.example.net" });
    expect(flagSuspicious(lookalike).suspicious?.reasons).toEqual(["lookalike-domain"]);
    expect(flagSuspicious(makeIncoming(2)).suspicious).toBeUndefined();
    const raised = { reasons: ["provider-phishing"], confidence: 0.99 };
    const flagged = makeIncoming(3, { from: "a@examp1e-mail.example.net", suspicious: raised });
    expect(flagSuspicious(flagged).suspicious).toEqual(raised);
  });
});
