import { t } from "@pochimail/ui/i18n/format.ts";
import { describe, expect, it } from "vitest";
import type { OverviewData } from "./overview-figures.ts";
import { cleanSplit, freeSizeLabel, sizeLabel } from "./overview-figures.ts";

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
  figures: {
    archived: 0,
    savedCount: 0,
    savedSize: 0,
    deletableSize: 0,
    unsubscribed: 0,
    totalSize: 0,
  },
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

  // Guards: a tiny size being shown as 0 MB (review boundaries 1023 and 1024 bytes).
  it("names a sub-tenth-MB size instead of claiming zero", () => {
    expect(sizeLabel(1023, t)).toBe("< 0.1 MB");
    expect(sizeLabel(1024, t)).toBe("< 0.1 MB");
    expect(freeSizeLabel(1024, 40_000_000, t)).toBe("< 0.1 MB you can free, out of 40 MB");
  });

  // Guards: raw-byte thresholds disagreeing with the rounded value (999.96e6 and 1e9).
  it("picks each figure's unit from its rounded value, even when the units differ", () => {
    expect(sizeLabel(999.96e6, t)).toBe("1 GB");
    expect(sizeLabel(1e9, t)).toBe("1 GB");
    expect(freeSizeLabel(999.96e6, 1e9, t)).toBe("1 GB you can free, out of 1 GB");
    expect(freeSizeLabel(12e6, 999.96e6, t)).toBe("12 MB you can free, out of 1 GB");
    expect(freeSizeLabel(1024, 1e9, t)).toBe("< 0.1 MB you can free, out of 1 GB");
  });
});
