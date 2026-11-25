import type { EmailType } from "@pochimail/classification/model/email-type";
import type { Language, Template } from "./content-types.ts";
import { TRANSACTIONAL } from "./transactional-content.ts";

// FAKE DATA ONLY: invented brands, invented people, reserved example domains. No real mail,
// no real address, no real company.

/** Placeholders: {n} number, {name} first name, {item} product/topic, {amount} money, {date} date. */
export const TEMPLATES: Record<EmailType, Record<Language, Template>> = {
  personal: {
    en: {
      subjects: ["Dinner on Friday?", "Photos from the weekend", "Quick question about {item}"],
      bodies: [
        "Hi,\nAre you free on Friday evening? We could try that new place.\nLet me know.\n{name}",
        "Hello,\nHere are the photos from the weekend. The second one is my favourite.\nTalk soon,\n{name}",
        "Hi,\nQuick question about {item}: do you still have the notes from last time?\nThanks,\n{name}",
      ],
    },
    fr: {
      subjects: ["Dîner vendredi ?", "Les photos du week-end", "Une question sur {item}"],
      bodies: [
        "Bonjour,\nEs-tu libre vendredi soir ? On pourrait essayer le nouveau restaurant près de chez toi.\nDis-moi vite.\n{name}",
        "Salut,\nVoici les photos du week-end, la deuxième est ma préférée. À bientôt !\n{name}",
        "Bonjour,\nJ'ai une petite question sur {item} : as-tu encore les notes de la dernière fois ?\nMerci d'avance,\n{name}",
      ],
    },
    ja: {
      subjects: ["金曜日の夕食", "週末の写真", "{item}についての質問"],
      bodies: [
        "こんにちは。\n金曜日の夜は空いていますか？新しいお店に行ってみましょう。\n{name}",
        "こんにちは。\n週末の写真を送ります。二枚目が一番気に入っています。\nまたね。\n{name}",
        "こんにちは。\n{item}について質問があります。前回のメモはまだありますか？\nよろしくお願いします。\n{name}",
      ],
    },
  },
  transactional: TRANSACTIONAL,
  notification: {
    en: {
      subjects: ["{name} commented on {item}", "Your weekly activity", "Reminder: {item}"],
      bodies: [
        "{name} left a comment on {item}.\nOpen the app to read it.",
        "Here is your activity this week: {n} updates on {item}.",
        "Reminder: {item} is coming up on {date}.",
      ],
    },
    fr: {
      subjects: ["{name} a commenté {item}", "Votre activité de la semaine", "Rappel : {item}"],
      bodies: [
        "{name} a laissé un commentaire sur {item}.\nOuvrez l'application pour le lire.",
        "Voici votre activité de la semaine : {n} mises à jour sur {item}.",
        "Rappel : {item} approche, le {date}.",
      ],
    },
    ja: {
      subjects: [
        "{name}さんが{item}にコメントしました",
        "今週のアクティビティ",
        "リマインダー：{item}",
      ],
      bodies: [
        "{name}さんが{item}にコメントしました。\nアプリで確認してください。",
        "今週のアクティビティ：{item}に{n}件の更新があります。",
        "リマインダー：{item}は{date}に予定されています。",
      ],
    },
  },
  newsletter: {
    en: {
      subjects: ["The Weekly Digest #{n}", "This month in {item}", "Five stories on {item}"],
      bodies: [
        "Welcome to issue #{n}. This week: {item}, and what to read next.\nFrom the editors at the weekly desk.\nUnsubscribe at any time.",
        "This month in {item}: three ideas worth your time.\nFrom the newsroom, with thanks for reading.",
        "Five stories on {item}, hand-picked for you.\nUnsubscribe at the bottom of this email.",
      ],
    },
    fr: {
      subjects: [
        "La lettre de la semaine n°{n}",
        "Ce mois-ci : {item}",
        "Cinq histoires sur {item}",
      ],
      bodies: [
        "Bienvenue dans le numéro {n}. Cette semaine : {item}, et nos lectures.\nVous pouvez vous désabonner à tout moment.",
        "Ce mois-ci : trois idées sur {item} qui valent le détour.\nMerci de nous lire.",
        "Cinq histoires sur {item}, choisies pour vous.\nDésabonnement en bas de ce message.",
      ],
    },
    ja: {
      subjects: ["週刊ダイジェスト第{n}号", "今月の{item}", "{item}についての5つの話"],
      bodies: [
        "第{n}号へようこそ。今週は{item}と、おすすめの記事をお届けします。\nいつでも配信停止できます。",
        "今月の{item}：読む価値のある三つのアイデア。\nお読みいただきありがとうございます。",
        "{item}についての5つの話をお届けします。\n配信停止はこのメールの下部から。",
      ],
    },
  },
  promotion: {
    en: {
      subjects: ["{n}% off {item} this weekend", "Last chance: {item}", "Members get early access"],
      bodies: [
        "Save {n}% on {item} until {date}. Use the code in the shop.",
        "Last chance to get {item} at {amount}. The offer ends {date}.",
        "Members get early access to our new range of {item}.",
      ],
    },
    fr: {
      subjects: [
        "{n} % de remise sur {item}",
        "Dernière chance : {item}",
        "Accès anticipé pour les membres",
      ],
      bodies: [
        "Économisez {n} % sur {item} jusqu'au {date}. Utilisez le code en boutique.",
        "Dernière chance d'obtenir {item} à {amount}. L'offre se termine le {date}.",
        "Les membres ont un accès anticipé à notre nouvelle gamme de {item}.",
      ],
    },
    ja: {
      subjects: ["{item}が{n}％オフ", "最終日：{item}", "会員限定の先行販売"],
      bodies: [
        "{date}まで{item}が{n}％オフ。店頭でコードをご利用ください。",
        "{item}を{amount}で手に入れる最後のチャンス。{date}まで。",
        "会員のみなさまに{item}の新シリーズを先行販売します。",
      ],
    },
  },
};

export const ITEMS = {
  en: ["the garden", "a bicycle", "the trip", "headphones", "the budget", "a novel"],
  fr: ["le jardin", "un vélo", "le voyage", "un casque", "le budget", "un roman"],
  ja: ["庭", "自転車", "旅行", "ヘッドホン", "予算", "小説"],
} as const;

export interface Sender {
  readonly name: string;
  readonly address: string;
}

/** Invented senders per type other than personal; every domain is reserved (RFC 2606). */
export const SENDERS: Record<Exclude<EmailType, "personal">, readonly Sender[]> = {
  transactional: [
    { name: "Northwind Bank", address: "statements@bank.example.net" },
    { name: "Fabrikam Insurance", address: "policy@insure.example.net" },
    { name: "Tax Office", address: "documents@tax.example.org" },
    { name: "Contoso Shop", address: "orders@shop.example.net" },
    { name: "Wingtip Air", address: "booking@air.example.net" },
    { name: "Tailspin Rail", address: "tickets@rail.example.net" },
    { name: "Accounts", address: "no-reply@accounts.example.net" },
    { name: "Security", address: "security@id.example.net" },
  ],
  notification: [
    { name: "Projects", address: "notify@projects.example.net" },
    { name: "Calendar", address: "calendar@cal.example.net" },
    { name: "Community", address: "hello@community.example.org" },
  ],
  newsletter: [
    { name: "The Weekly Desk", address: "digest@weekly.example.org" },
    { name: "Garden Notes", address: "letters@garden.example.org" },
    { name: "Tech Sunday", address: "hello@sunday.example.net" },
  ],
  promotion: [
    { name: "Adventure Works", address: "deals@adventure.example.net" },
    { name: "Litware Outlet", address: "offers@outlet.example.net" },
    { name: "Proseware Home", address: "promo@home.example.net" },
  ],
};

export const SPOOFED_SENDER: Sender = {
  name: "Security",
  address: "security@id-examp1e-verify.example.net",
};

/** People the owner writes with; the first few are the important ones. */
export const CORRESPONDENTS: readonly (Sender & { readonly language: Language })[] = [
  { name: "Alice Martin", address: "alice.martin@example.org", language: "en" },
  { name: "Ben Carter", address: "ben.carter@example.com", language: "en" },
  { name: "Chloé Dubois", address: "chloe.dubois@example.org", language: "fr" },
  { name: "Étienne Laurent", address: "etienne.laurent@example.com", language: "fr" },
  { name: "Hélène Moreau", address: "helene.moreau@example.net", language: "fr" },
  { name: "田中 さくら", address: "sakura.tanaka@example.jp", language: "ja" },
  { name: "佐藤 はると", address: "haruto.sato@example.jp", language: "ja" },
  { name: "Grace Hopper-Lee", address: "grace.lee@example.net", language: "en" },
  { name: "Farid Haddad", address: "farid.haddad@example.org", language: "en" },
  { name: "Noémie Petit", address: "noemie.petit@example.com", language: "fr" },
];

/** The first `VIP_COUNT` correspondents are the important senders. */
export const VIP_COUNT = 4;
