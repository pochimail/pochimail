import { describe, expect, it } from "vitest";
import type { OverviewData } from "./overview-figures.ts";
import { cleanSplit } from "./overview-figures.ts";

const data: OverviewData = {
  scanned: 1000,
  toReview: 10,
  waiting: 7,
  deadlines: 1,
  important: 2,
  oldestWaitingDays: 9,
  cleanable: [
    { category: "promotions", count: 400 },
    { category: "notifications", count: 120 },
    { category: "sign-ins-security", count: 80 },
    { category: "newsletters", count: 300 },
  ],
};

describe("overview figures", () => {
  // Guards: an archive or unsubscribe count moving the free-space figure (ADR 0012).
  it("derives the deletable figure from delete rows only", () => {
    expect(cleanSplit(data).deletable).toBe(480);
    expect(cleanSplit({ ...data, cleanable: [{ category: "notifications", count: 900 }] })).toEqual(
      {
        deletable: 0,
        keep: 1000,
      },
    );
    expect(
      cleanSplit({ ...data, cleanable: [{ category: "newsletters", count: 900 }] }).deletable,
    ).toBe(0);
    expect(
      cleanSplit({ ...data, cleanable: [{ category: "promotions", count: 500 }] }).deletable,
    ).toBe(500);
  });

  // Guards: a negative "worth keeping" count when more emails are deletable than scanned.
  it("never shows negative stays", () => {
    expect(
      cleanSplit({ ...data, scanned: 100, cleanable: [{ category: "promotions", count: 400 }] }),
    ).toEqual({ deletable: 400, keep: 0 });
  });
});
