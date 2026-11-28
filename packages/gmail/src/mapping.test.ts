import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { expect, it } from "vitest";
import type { GmailMetadata } from "./api.ts";
import { toIncoming } from "./mapping.ts";

const identity = { workspaceId: "ws-a" as WorkspaceId, accountId: "acc-1" as AccountId };
const raw = (over: Partial<GmailMetadata> = {}): GmailMetadata => ({
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD"],
  sizeEstimate: 900,
  internalDate: String(Date.UTC(2026, 0, 2)),
  payload: {
    mimeType: "multipart/alternative",
    filename: "",
    parts: [],
    headers: [
      { name: "From", value: "Ada <Ada@Example.com>" },
      { name: "To", value: 'a@example.com, "B" <b@example.com>' },
      { name: "List-Unsubscribe", value: "<mailto:u@example.com>" },
    ],
  },
  ...over,
});

// Guards: a record that stores more than ids, dates, flags and addresses, or flags that read wrong.
it("maps metadata to the minimal record with empty subject and snippet", () => {
  expect(toIncoming(raw(), identity)).toMatchObject({
    id: "m1",
    threadId: "t1",
    from: "ada@example.com",
    to: ["a@example.com", "b@example.com"],
    subject: "",
    snippet: "",
    receivedAt: "2026-01-02T00:00:00.000Z",
    hasListUnsubscribe: true,
    opened: false,
  });
  expect(
    toIncoming(
      raw({
        labelIds: ["INBOX"],
        payload: { ...raw().payload, headers: [{ name: "From", value: "a@example.com" }] },
      }),
      identity,
    ),
  ).toMatchObject({
    opened: true,
    hasListUnsubscribe: false,
  });
});

// Guards: a half-stored message when Gmail returns something we cannot use.
it("skips a message without a usable sender or date", () => {
  expect(toIncoming(raw({ payload: { ...raw().payload, headers: [] } }), identity)).toBeNull();
  expect(toIncoming(raw({ internalDate: "soon" }), identity)).toBeNull();
});

// Guards: every real message carrying "kept safe", or a signed or related message wrongly counted as having no file.
it("counts what the payload shows and leaves unknown what it cannot tell", () => {
  const payload = (
    mimeType: string,
    parts: GmailMetadata["payload"]["parts"] = [],
    filename = "",
  ) => ({ ...raw().payload, mimeType, filename, parts });
  const part = (filename: string) => ({ filename });
  const count = (p: GmailMetadata["payload"]) =>
    toIncoming(raw({ payload: p }), identity)?.savedCount;
  expect(count(payload("text/plain"))).toBe(0);
  expect(count(payload("multipart/alternative"))).toBe(0);
  expect(count(payload("multipart/alternative", [], "a.pdf"))).toBe(1);
  expect(count(payload("application/pdf", [], "a.pdf"))).toBe(1);
  expect(count(payload("application/pdf"))).toBeUndefined();
  expect(count(payload("multipart/signed"))).toBeUndefined();
  expect(count(payload("multipart/related"))).toBeUndefined();
  expect(count(payload("multipart/mixed", [part(""), part("a.pdf")]))).toBe(1);
  // The metadata format omits parts: a mixed body is the only sign of a file.
  expect(count(payload("multipart/mixed"))).toBe(1);
  expect(toIncoming(raw({ payload: payload("multipart/signed") }), identity)).not.toHaveProperty(
    "savedCount",
  );
});
