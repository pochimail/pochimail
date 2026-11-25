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

  // Guards: the archive-alert-emails card must say which emails, why, and what Review does (#183).
  it("explains the archive-alert-emails card in every locale", () => {
    const cases = [
      {
        catalog: messages,
        sentence: /archive alert emails/i,
        reason: [
          /automated alerts/i,
          /not emails from people/i,
          /review opens the list/i,
          /nothing is archived until you approve/i,
        ],
      },
      {
        catalog: fr,
        sentence: /archiver les emails d’alerte/i,
        reason: [
          /alertes automatiques/i,
          /pas des emails de personnes/i,
          /examiner ouvre la liste/i,
          /rien n’est archivé avant votre accord/i,
        ],
      },
      {
        catalog: ja,
        sentence: /通知メールをアーカイブ/,
        reason: [
          /自動送信された通知メール/,
          /個人からのメールではありません/,
          /確認する.*一覧が開き/,
          /承認するまで何もアーカイブされません/,
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
  // Guards: the pre-ADR-0012 "nothing is deleted" reassurance creeping back into the copy (#114).
  it("drops the 'nothing is deleted' reassurance from the summary, notifications and setup copy", () => {
    expect(messages["summary.sentence"].text).not.toMatch(/nothing was deleted/i);
    expect(fr["summary.sentence"].text).not.toMatch(/rien n’a été supprimé/i);
    expect(ja["summary.sentence"].text).not.toContain("削除したものはありません");
    expect(messages["overview.rec.notifications.reason"].text).not.toMatch(/nothing is deleted/i);
    expect(fr["overview.rec.notifications.reason"].text).not.toMatch(/rien n’est supprimé/i);
    expect(ja["overview.rec.notifications.reason"].text).not.toContain("削除もされません");
    expect(messages["setup.invariants"].text).not.toMatch(/never delete/i);
    expect(fr["setup.invariants"].text).not.toMatch(/ne supprime jamais rien/i);
    expect(ja["setup.invariants"].text).not.toContain("何も削除せず");
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

  // Guards: a vague or sprawling Alert emails empty state (#224).
  it("explains what Alert emails holds, where the mail stays and what appears later", () => {
    const placeholders = [
      {
        text: messages["category.notifications.placeholder"].text,
        source: /alert emails from apps and social networks/iu,
        approval: /after you approve/iu,
        label: /only label them/iu,
        inbox: /in your inbox/iu,
      },
      {
        text: fr["category.notifications.placeholder"].text,
        source: /emails d’alerte d’applications et de réseaux sociaux/u,
        approval: /après votre accord/u,
        label: /je les étiquette/u,
        inbox: /boîte de réception/u,
      },
      {
        text: ja["category.notifications.placeholder"].text,
        source: /アプリやSNSからの通知メール/u,
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
