import { describe, expect, it } from "vitest";
import { fr } from "./fr.ts";
import { ja } from "./ja.ts";
import { messages } from "./messages.ts";

const catalogs = [messages, fr, ja];

describe("catalog copy (brief §6 › Voice, design › Writing)", () => {
  it("never writes 'mails' in any catalog (guards the old word creeping back)", () => {
    for (const catalog of catalogs)
      for (const message of Object.values(catalog)) expect(message.text).not.toMatch(/\bmails\b/iu);
    expect(messages["overview.email.count"].text).toMatch(/\bemails\b/);
  });

  it("uses {device} for the host instead of a literal Mac (guards copy that breaks on Windows)", () => {
    for (const catalog of catalogs)
      expect(catalog["overview.promise.device"].params).toContain("device");
    for (const message of Object.values(messages)) expect(message.text).not.toMatch(/\bMac\b/u);
  });

  it("covers every English key with the same placeholders (guards an untranslated string)", () => {
    for (const catalog of catalogs)
      for (const key of Object.keys(messages) as (keyof typeof messages)[]) {
        expect(catalog[key].params).toEqual(messages[key].params);
        for (const param of messages[key].params)
          expect(catalog[key].text, `${key} dropped {${param}}`).toContain(`{${param}`);
      }
  });

  it("keeps screen titles functional and never ships placeholder tokens (guards greeting titles)", () => {
    for (const catalog of catalogs) expect(catalog["overview.title"].params).toEqual([]);
    expect(messages["overview.title"].text).toBe("Overview");
    for (const catalog of catalogs)
      for (const message of Object.values(catalog)) expect(message.text).not.toMatch(/\[[A-Z]\]/u);
  });

  it("explains what Notifications holds, where the mail stays and what appears later (guards a vague empty state)", () => {
    expect(messages["category.notifications.placeholder"].text).toMatch(/app and social alerts/iu);
    expect(messages["category.notifications.placeholder"].text).toMatch(/stay in your inbox/iu);
    expect(messages["category.notifications.placeholder"].text).toMatch(/after that/iu);
    expect(fr["category.notifications.placeholder"].text).toMatch(/boîte de réception/u);
    expect(ja["category.notifications.placeholder"].text).toMatch(/受信トレイ/u);
  });
});
