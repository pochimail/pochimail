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

  it("explains the archive-notifications card in every locale", () => {
    const cases = [
      {
        catalog: messages,
        sentence: /app and social notifications/i,
        reason: [
          /automated alerts/i,
          /not emails from people/i,
          /review opens the list/i,
          /nothing is archived until you approve/i,
          /nothing is deleted/i,
        ],
      },
      {
        catalog: fr,
        sentence: /notifications d’applications et de réseaux sociaux/i,
        reason: [
          /alertes automatiques/i,
          /pas des emails de personnes/i,
          /examiner ouvre la liste/i,
          /rien n’est archivé avant votre accord/i,
          /rien n’est supprimé/i,
        ],
      },
      {
        catalog: ja,
        sentence: /アプリやSNSからの通知/,
        reason: [
          /自動送信された通知/,
          /個人からのメールではありません/,
          /確認する.*一覧が開き/,
          /承認するまで何もアーカイブされず/,
          /削除もされません/,
        ],
      },
    ];
    for (const { catalog, sentence, reason } of cases) {
      expect(catalog["overview.rec.notifications.sentence"].text).toMatch(sentence);
      const detail = catalog["overview.rec.notifications.reason"].text;
      for (const pattern of reason) expect(detail).toMatch(pattern);
      // The explanation names the button the card actually shows.
      expect(detail).toContain(catalog["overview.review"].text);
    }
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

  // Guards: the archive-notifications card must say which emails, why, and what Review does (#183).

});
