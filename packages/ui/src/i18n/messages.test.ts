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

  // Guards: the archive-notifications card must say which emails, why, and what Review does (#183).
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

  // Guards: a footnote tied to category names instead of protecting signals (ADR 0012).
  it("says important-looking email is never pre-selected for you in every catalog", () => {
    expect(messages["overview.clean.never"].text).toMatch(/look important/u);
    expect(messages["overview.clean.never"].text).toMatch(/never selected for you/u);
    expect(fr["overview.clean.never"].text).toMatch(/semblent importants/u);
    expect(fr["overview.clean.never"].text).toMatch(/jamais sélectionnés/u);
    expect(ja["overview.clean.never"].text).toContain("重要そうなメール");
    expect(ja["overview.clean.never"].text).toContain("選択しません");
  });
  it("covers every English key with the same placeholders (guards an untranslated string)", () => {
    for (const catalog of catalogs)
      for (const key of Object.keys(messages) as (keyof typeof messages)[]) {
        expect(catalog[key].params).toEqual(messages[key].params);
        for (const param of messages[key].params)
          expect(catalog[key].text, `${key} dropped {${param}}`).toContain(`{${param}`);
      }
  });

  it("promises local processing, not storage, in the Connect privacy promise", () => {
    expect(messages["connect.promise.local.title"].text).toBe(
      "Your email is only processed on this {device}",
    );
    expect(fr["connect.promise.local.title"].text).toBe(
      "Vos emails sont traités uniquement sur votre {device}",
    );
    expect(ja["connect.promise.local.title"].text).toBe("メールはこの{device}の中だけで処理します");
    for (const catalog of catalogs)
      expect(catalog["connect.promise.local.title"].params).toContain("device");
  });
  it("keeps screen titles functional and never ships placeholder tokens (guards greeting titles)", () => {
    for (const catalog of catalogs) expect(catalog["overview.title"].params).toEqual([]);
    expect(messages["overview.title"].text).toBe("Overview");
    for (const catalog of catalogs)
      for (const message of Object.values(catalog)) expect(message.text).not.toMatch(/\[[A-Z]\]/u);
  });

  // Guards: the connect promise reverting to permission phrasing or dropping the approval guarantee.
  it("frames the delete promise as user control in every catalog", () => {
    expect(messages["connect.promise.delete.title"].text).toBe("You keep the control");
    expect(fr["connect.promise.delete.title"].text).toBe("Vous gardez le contrôle");
    expect(ja["connect.promise.delete.title"].text).toBe("主導権はあなたにあります");
    expect(messages["connect.promise.delete.body"].text).toBe(
      "Nothing is deleted without your approval. Deleted emails go to the Trash, and you can undo.",
    );
    expect(fr["connect.promise.delete.body"].text).toBe(
      "Rien n’est supprimé sans votre accord. Les emails supprimés vont dans la corbeille, et vous pouvez annuler.",
    );
    expect(ja["connect.promise.delete.body"].text).toBe(
      "ご承認なしに削除はしません。削除したメールはゴミ箱に入り、元に戻せます。",
    );
  });

  it("explains what Notifications holds, where the mail stays and what appears later (guards a vague empty state)", () => {
    expect(messages["category.notifications.placeholder"].text).toMatch(/app and social alerts/iu);
    expect(messages["category.notifications.placeholder"].text).toMatch(/stay in your inbox/iu);
    expect(messages["category.notifications.placeholder"].text).toMatch(/after that/iu);
    expect(fr["category.notifications.placeholder"].text).toMatch(/boîte de réception/u);
    expect(ja["category.notifications.placeholder"].text).toMatch(/受信トレイ/u);
  });
});
