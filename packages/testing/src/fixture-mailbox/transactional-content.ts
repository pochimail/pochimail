// FAKE DATA ONLY: invented brands and reserved example domains.
// Transactional mail is the union of what used to be separate kinds: statements and documents,
// orders and bookings, sign-in and security messages. Subject i goes with body i.

import type { Language, Template } from "./content-types.ts";

const STATEMENTS: Record<Language, Template> = {
  en: {
    subjects: ["Your statement for {date}", "Tax document {n} is ready", "Policy renewal notice"],
    bodies: [
      "Your statement for {date} is ready. The balance is {amount}.\nThe document is attached.",
      "Your tax document {n} is available. Please keep it with your records.",
      "Your policy renews on {date}. The new premium is {amount}.",
    ],
  },
  fr: {
    subjects: [
      "Votre relevé du {date}",
      "Document fiscal {n} disponible",
      "Avis de renouvellement",
    ],
    bodies: [
      "Votre relevé du {date} est disponible. Le solde est de {amount}.\nLe document est en pièce jointe.",
      "Votre document fiscal {n} est disponible. Conservez-le avec vos papiers.",
      "Votre contrat est renouvelé le {date}. La nouvelle prime est de {amount}.",
    ],
  },
  ja: {
    subjects: ["{date}のご利用明細", "税務書類{n}のお知らせ", "契約更新のご案内"],
    bodies: [
      "{date}のご利用明細をお送りします。残高は{amount}です。\n書類は添付ファイルをご確認ください。",
      "税務書類{n}をご用意しました。大切に保管してください。",
      "ご契約は{date}に更新されます。新しい保険料は{amount}です。",
    ],
  },
};

const ORDERS: Record<Language, Template> = {
  en: {
    subjects: [
      "Your order #{n} has shipped",
      "Receipt for your purchase",
      "Booking confirmed: {item}",
    ],
    bodies: [
      "Good news: your order #{n} for {item} has shipped. Total {amount}.",
      "Thanks for your purchase of {item}. Your receipt for {amount} is attached.",
      "Your booking for {item} is confirmed for {date}. Total {amount}.",
    ],
  },
  fr: {
    subjects: [
      "Votre commande n°{n} est expédiée",
      "Reçu pour votre achat",
      "Réservation confirmée : {item}",
    ],
    bodies: [
      "Bonne nouvelle : votre commande n°{n} ({item}) a été expédiée. Total {amount}.",
      "Merci pour votre achat de {item}. Votre reçu de {amount} est en pièce jointe.",
      "Votre réservation pour {item} est confirmée le {date}. Total {amount}.",
    ],
  },
  ja: {
    subjects: ["ご注文#{n}を発送しました", "ご購入の領収書", "ご予約確定：{item}"],
    bodies: [
      "ご注文#{n}（{item}）を発送しました。合計{amount}です。",
      "{item}をご購入いただきありがとうございます。{amount}の領収書を添付します。",
      "{item}のご予約が{date}で確定しました。合計{amount}です。",
    ],
  },
};

const SIGN_INS: Record<Language, Template> = {
  en: {
    subjects: ["Your verification code", "New sign-in to your account", "Reset your password"],
    bodies: [
      "Your verification code is {n}. It expires in 10 minutes. Never share it.",
      "We noticed a new sign-in to your account on {date}. If this was you, no action is needed.",
      "Use this request to reset your password. It expires in one hour.",
    ],
  },
  fr: {
    subjects: [
      "Votre code de vérification",
      "Nouvelle connexion à votre compte",
      "Réinitialisez votre mot de passe",
    ],
    bodies: [
      "Votre code de vérification est {n}. Il expire dans 10 minutes. Ne le partagez jamais.",
      "Nous avons détecté une nouvelle connexion à votre compte le {date}. Si c'était vous, rien à faire.",
      "Utilisez cette demande pour réinitialiser votre mot de passe. Elle expire dans une heure.",
    ],
  },
  ja: {
    subjects: ["確認コードのお知らせ", "アカウントへの新しいログイン", "パスワードの再設定"],
    bodies: [
      "確認コードは{n}です。10分で無効になります。他人に教えないでください。",
      "{date}にアカウントへの新しいログインがありました。ご本人であれば操作は不要です。",
      "このリクエストでパスワードを再設定できます。有効期限は1時間です。",
    ],
  },
};

/** One template per language holding every subject and body, in the order given: a subject and its body share an index. */
const merge = (...parts: readonly Record<Language, Template>[]): Record<Language, Template> => {
  const of = (language: Language): Template => ({
    subjects: parts.flatMap((p) => p[language].subjects),
    bodies: parts.flatMap((p) => p[language].bodies),
  });
  return { en: of("en"), fr: of("fr"), ja: of("ja") };
};

export const TRANSACTIONAL: Record<Language, Template> = merge(STATEMENTS, ORDERS, SIGN_INS);
