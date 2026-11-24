import { describe, expect, it } from "vitest";
import { DisplayFieldsCache } from "./display-fields-cache.ts";

describe("DisplayFieldsCache", () => {
  // Guards: private display fields accumulating without bound in a long-lived unit of work.
  it("drops the least recently used fields once the bound is reached", () => {
    const cache = new DisplayFieldsCache(2);
    cache.rememberFields("message", "w", "a", { subject: "first" });
    cache.rememberFields("message", "w", "b", { subject: "second" });
    expect(cache.ofFields("message", "w", "a").subject).toBe("first"); // a becomes newest again
    cache.rememberFields("message", "w", "c", { subject: "third" });
    expect(cache.ofFields("message", "w", "b").subject).toBeUndefined();
    expect(cache.ofFields("message", "w", "a").subject).toBe("first");
    expect(cache.ofFields("message", "w", "c").subject).toBe("third");
  });
});
