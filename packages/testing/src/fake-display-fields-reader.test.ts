import { createCancelSource } from "@pochimail/kernel/common";
import type { MessageId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { createFakeDisplayFieldsReader } from "./fake-display-fields-reader.ts";

// Guards: a live display-fields read returns only the requested ids and never invents private data.
describe("fake display fields reader", () => {
  it("returns only requested fields and honours cancellation", async () => {
    const reader = createFakeDisplayFieldsReader([
      { id: "msg-1" as MessageId, subject: "Subject 1", snippet: "Snippet 1" },
      { id: "msg-2" as MessageId, subject: "Subject 2", snippet: "Snippet 2" },
    ]);
    const { signal, abort } = createCancelSource();
    expect(unwrap(await reader.fetchDisplayFields(["msg-2" as MessageId], signal))).toEqual([
      { id: "msg-2" as MessageId, subject: "Subject 2", snippet: "Snippet 2" },
    ]);
    abort();
    expect((await reader.fetchDisplayFields(["msg-1" as MessageId], signal)).ok).toBe(false);
  });
});
