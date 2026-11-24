import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, t, translate } from "./format.ts";
import { entry } from "./messages.ts";

afterEach(() => setLocale("en"));

describe("t() (design › Writing, P13)", () => {
  it("formats zero, one and many emails with the right English plural (guards '1 emails')", () => {
    expect(t("overview.email.count", { count: 0 })).toBe("No emails");
    expect(t("overview.email.count", { count: 1 })).toBe("1 email");
    expect(t("overview.email.count", { count: 1240 })).toBe("1,240 emails");
  });

  it("groups numbers in the clean-up headline (guards raw 3100 leaking into copy)", () => {
    expect(t("overview.size.free", { size: 3100, total: 6400 })).toBe(
      "3,100 GB you can free, out of 6,400 GB",
    );
  });

  // Guards: the saved-attachments figure shipping a raw byte count or an English-only unit (#114).
  it("formats the saved-attachments size in GB per locale and composes the figure label", () => {
    expect(t("overview.size.gb", { size: 1.2 })).toBe("1.2 GB");
    expect(t("overview.size.gb", { size: 1.2 }, { locale: "fr" })).toBe("1,2 Go");
    expect(t("overview.size.gb", { size: 1.2 }, { locale: "ja" })).toBe("1.2 GB");
    expect(
      t("storageBar.legendItem", {
        label: t("summary.figure.saved"),
        size: t("overview.size.gb", { size: 1.2 }),
      }),
    ).toBe("attachments saved · 1.2 GB");
  });

  // Guards: a 12 MB figure rounding to 0 GB in any locale (#114).
  it("formats small sizes in MB per locale and composes the figure label", () => {
    expect(t("overview.size.mb", { size: 12 })).toBe("12 MB");
    expect(t("overview.size.mb", { size: 12 }, { locale: "fr" })).toBe("12 Mo");
    expect(t("overview.size.mb", { size: 12 }, { locale: "ja" })).toBe("12 MB");
    expect(t("overview.size.freeMb", { size: 12, total: 40 })).toBe(
      "12 MB you can free, out of 40 MB",
    );
    expect(t("overview.size.freeMb", { size: 12, total: 40 }, { locale: "fr" })).toBe(
      "12 Mo à libérer, sur 40 Mo",
    );
    expect(t("overview.size.freeMb", { size: 12, total: 40 }, { locale: "ja" })).toBe(
      "合計40 MBのうち、12 MBを空けられます。",
    );
    expect(
      t("storageBar.legendItem", {
        label: t("summary.figure.saved"),
        size: t("overview.size.mb", { size: 2.4 }),
      }),
    ).toBe("attachments saved · 2.4 MB");
  });

  it("substitutes the device name from the port, never a hard-coded Mac (guards Windows copy)", () => {
    expect(t("overview.sorting", { device: "PC" })).toBe("Sorting privately on this PC");
    expect(t("overview.promise.device", { device: "device" })).toBe(
      "Your email never leaves this device.",
    );
  });

  it("uses French plural and number rules (guards English rules and grouping in French)", () => {
    expect(t("overview.email.count", { count: 0 }, { locale: "fr" })).toBe("Aucun email");
    expect(t("overview.email.count", { count: 1 }, { locale: "fr" })).toBe("1 email");
    expect(t("overview.email.count", { count: 1240 }, { locale: "fr" })).toBe("1\u202f240 emails");
    expect(t("overview.size.free", { size: 3100, total: 6400 }, { locale: "fr" })).toBe(
      "3\u202f100 Go à libérer, sur 6\u202f400 Go",
    );
  });

  it("follows French 'one' for 0 and 1 (guards the English plural category being hard-coded)", () => {
    const singular = {
      "overview.email.count": entry("{count, plural, one {# email} other {# emails}}", ["count"]),
    };
    expect(translate(singular, "overview.email.count", { count: 0 }, "fr")).toBe("0 email");
    expect(translate(singular, "overview.email.count", { count: 1 }, "fr")).toBe("1 email");
    expect(translate(singular, "overview.email.count", { count: 2 }, "fr")).toBe("2 emails");
  });

  it("uses Japanese counts with no plural distinction (guards '# emails' English forms in Japanese)", () => {
    expect(t("overview.email.count", { count: 0 }, { locale: "ja" })).toBe("メールはありません");
    expect(t("overview.email.count", { count: 1 }, { locale: "ja" })).toBe("1件のメール");
    expect(t("overview.email.count", { count: 1240 }, { locale: "ja" })).toBe("1,240件のメール");
    const bare = {
      "overview.email.count": entry("{count, plural, one {# email} other {# emails}}", ["count"]),
    };
    expect(translate(bare, "overview.email.count", { count: 5 }, "ja")).toBe("5 emails");
  });

  it("formats dates with the active locale's order and month names (guards US dates in French)", () => {
    const date = "2026-11-19T12:00:00Z";
    expect(t("summary.from", { date, device: "Mac" })).toBe(
      "From Pochi · November 19, 2026 · on this Mac",
    );
    expect(t("summary.from", { date, device: "Mac" }, { locale: "fr" })).toBe(
      "De Pochi · 19 novembre 2026 · sur votre Mac",
    );
    expect(t("summary.from", { date, device: "Mac" }, { locale: "ja" })).toBe(
      "Pochiより · 2026年11月19日 · このMacで",
    );
  });

  it("uses the app-wide locale set at startup (guards t() ignoring the resolved OS language)", () => {
    expect(getLocale()).toBe("en");
    setLocale("ja");
    expect(t("overview.title")).toBe("概要");
  });

  it("rejects the dev-only pseudo locale as an app language (guards pseudo shipping as a choice)", () => {
    const setPseudo = (): void => {
      // @ts-expect-error `pseudo` is a layout probe, never user-selectable; this must not compile.
      setLocale("pseudo");
    };
    expect(setPseudo).toBeTypeOf("function");
  });

  it("falls back to English when a catalog lacks a key (guards a blank line on a new string)", () => {
    expect(translate({}, "overview.title", undefined, "fr")).toBe("Overview");
  });

  it("produces long accented pseudo-locale copy for expansion stories (guards untested FR/JA layout)", () => {
    const english = "Sorting privately on this Mac";
    const pseudo = t("overview.sorting", { device: "Mac" }, { locale: "pseudo" });
    expect(pseudo).toMatch(/[äëïöüÿ]/u);
    expect(pseudo.length).toBeGreaterThan(english.length * 1.5);
  });
});
