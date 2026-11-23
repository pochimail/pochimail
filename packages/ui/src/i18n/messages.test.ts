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

  // Guards: a footnote that only says what is "never cleaned" (issue #184).
  it("says personal conversations, records and receipts are always kept and why they are absent from the clean-up list in every catalog", () => {
    expect(messages["overview.clean.never"].text).toMatch(/always keep/u);
    expect(messages["overview.clean.never"].text).toMatch(/clean-up list above/u);
    expect(fr["overview.clean.never"].text).toMatch(/garde toujours/u);
    expect(fr["overview.clean.never"].text).toMatch(/liste de nettoyage/u);
    expect(ja["overview.clean.never"].text).toContain("必ず残");
    expect(ja["overview.clean.never"].text).toContain("整理リスト");
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

  // Guards: a vague or sprawling Notifications empty state (#224).
  it("explains what Notifications holds, where the mail stays and what appears later", () => {
    const placeholders = [
      {
        text: messages["category.notifications.placeholder"].text,
        source: /app and social alerts/iu,
        approval: /after you approve/iu,
        label: /only label them/iu,
        inbox: /in your inbox/iu,
      },
      {
        text: fr["category.notifications.placeholder"].text,
        source: /alertes d’applications et de réseaux sociaux/u,
        approval: /après votre accord/u,
        label: /je les étiquette/u,
        inbox: /boîte de réception/u,
      },
      {
        text: ja["category.notifications.placeholder"].text,
        source: /アプリやSNSからの通知/u,
        approval: /承認/u,
        label: /ラベルを付けるだけ/u,
        inbox: /受信トレイ/u,
      },
    ];
    for (const { text, source, approval, label, inbox } of placeholders) {
      expect(text).toMatch(source);
      expect(text).toMatch(approval);
      expect(text).toMatch(label);
      expect(text).toMatch(inbox);
      expect(text.length).toBeLessThan(160);
    }
  });
});
