import { CATEGORIES, type Category } from "@pochimail/classification/model/category";
import {
  CORRESPONDENTS,
  ITEMS,
  type Language,
  SENDERS,
  SPOOFED_SENDER,
  TEMPLATES,
  VIP_COUNT,
} from "./content.ts";
import { type LabelsFile, labelsFileSchema, type MessageLabel } from "./labels.ts";
import {
  type Charset,
  encodeBase64Body,
  encodeHeaderText,
  encodeQuotedPrintable,
  quoteFromLines,
} from "./mbox.ts";
import { apportion, createRng, type Rng } from "./prng.ts";

// FAKE DATA ONLY. The mock dataset of brief §6, reproduced with a seeded generator:
// 2 accounts, 7 categories, 7 people waiting (oldest 9 days), 3 deadlines this week,
// 12 new from important people, 412 documents. `small` is the same shape at about 1 %.

export const FIXTURE_WORKSPACE_ID = "ws-fixture";
export const MESSAGE_ID_DOMAIN = "fixture.example";
/** "Today" inside the fixture. Fixed, so ages (and therefore labels) never depend on the clock. */
export const FIXTURE_NOW = Date.UTC(2026, 10, 17, 9, 0, 0);

/** Brief §6 › Mock data. */
export const MOCK_DATASET = {
  totalMessages: 48_312,
  documents: 412,
  peopleWaiting: 7,
  oldestWaitingDays: 9,
  deadlinesThisWeek: 3,
  newFromImportant: 12,
  categories: {
    people: 6_820,
    records: 2_104,
    "purchases-travel": 3_580,
    "sign-ins-security": 1_962,
    notifications: 14_230,
    newsletters: 10_410,
    promotions: 9_206,
  } satisfies Record<Category, number>,
} as const;

export const MAILBOX_SCALES = { small: 483, full: MOCK_DATASET.totalMessages } as const;
export type MailboxScale = keyof typeof MAILBOX_SCALES;

export interface FixtureAccount {
  readonly id: string;
  readonly provider: "gmail" | "graph";
  readonly address: string;
  /** The whole mailbox as one mboxrd file (pure ASCII). */
  readonly mbox: string;
}

export interface GeneratedMailbox {
  readonly workspaceId: string;
  readonly accounts: readonly FixtureAccount[];
  readonly labels: LabelsFile;
}

const ACCOUNT_DEFS = [
  {
    id: "acc-gmail-personal",
    short: "gm",
    provider: "gmail",
    address: "pochi.demo@example.com",
    share: 0.62,
  },
  {
    id: "acc-outlook-work",
    short: "ol",
    provider: "graph",
    address: "pochi.demo@example.org",
    share: 0.38,
  },
] as const;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const YEARS = 9;
const OWNER_NAME = "Pochi Demo";
const WAITING_AGES_DAYS = [9, 6, 5, 4, 3, 2, 1];

const OPENED_RATE: Record<Category, number> = {
  people: 0.95,
  records: 0.85,
  "purchases-travel": 0.8,
  "sign-ins-security": 0.5,
  notifications: 0.2,
  newsletters: 0.25,
  promotions: 0.1,
};

const REPLIES: Record<Language, readonly string[]> = {
  en: ["Thanks, that works for me.", "Sounds good, let me check and get back to you."],
  fr: ["Merci, ça me va.", "Très bien, je regarde et je te réponds."],
  ja: ["ありがとう、それで大丈夫です。", "了解です。確認して返信します。"],
};

const DEADLINE: Record<Language, { subject: string; body: string }> = {
  en: {
    subject: "Action needed by {date}: statement review",
    body: "Please review your statement by {date}.",
  },
  fr: {
    subject: "À faire avant le {date} : relevé",
    body: "Merci de vérifier votre relevé avant le {date}.",
  },
  ja: {
    subject: "{date}までにご対応ください：明細確認",
    body: "{date}までに明細をご確認ください。",
  },
};

interface Plan {
  seq: number;
  category: Category;
  language: Language;
  accountIdx: number;
  threadKey: number;
  pos: number;
  inbound: boolean;
  peer: { name: string; address: string };
  at: number;
  subject: string;
  body: string;
  opened: boolean;
  listUnsubscribe: boolean;
  attachmentSize: number;
  suspicious: boolean;
  signals: Set<MessageLabel["signals"][number]>;
}

function pickLanguage(rng: Rng): Language {
  const roll = rng.next();
  return roll < 0.7 ? "en" : roll < 0.9 ? "fr" : "ja";
}

function fill(text: string, rng: Rng, language: Language, at: number, name: string): string {
  const amount =
    language === "en"
      ? `USD ${rng.int(5, 900)}.${String(rng.int(0, 99)).padStart(2, "0")}`
      : language === "fr"
        ? `${rng.int(5, 900)},${String(rng.int(0, 99)).padStart(2, "0")} EUR`
        : `${rng.int(500, 90000)}円`;
  return text
    .replaceAll("{n}", String(rng.int(100, 99_999)))
    .replaceAll("{name}", name)
    .replaceAll("{item}", rng.pick(ITEMS[language]))
    .replaceAll("{amount}", amount)
    .replaceAll("{date}", new Date(at + rng.int(1, 6) * DAY).toISOString().slice(0, 10));
}

function threadLength(category: Category, rng: Rng): number {
  if (category === "people")
    return rng.chance(0.07) ? rng.int(8, 30) : rng.chance(0.35) ? rng.int(2, 4) : 1;
  if (category === "purchases-travel" && rng.chance(0.15)) return rng.int(2, 3);
  return 1;
}

function planAll(rng: Rng, total: number): Plan[] {
  const counts = apportion(
    total,
    CATEGORIES.map((c) => MOCK_DATASET.categories[c]),
  );
  const plans: Plan[] = [];
  let threadKey = 0;
  let seq = 0;

  for (const [index, category] of CATEGORIES.entries()) {
    let remaining = counts[index] ?? 0;
    let threadInCategory = 0;
    while (remaining > 0) {
      const t = threadInCategory++;
      const waiting = category === "people" && t < MOCK_DATASET.peopleWaiting;
      const important =
        category === "people" &&
        t >= MOCK_DATASET.peopleWaiting &&
        t < MOCK_DATASET.peopleWaiting + MOCK_DATASET.newFromImportant;
      const length = Math.min(
        waiting ? rng.int(1, 3) : important ? 1 : threadLength(category, rng),
        remaining,
      );
      remaining -= length;
      const key = threadKey++;
      const accountIdx = rng.chance(ACCOUNT_DEFS[0].share) ? 0 : 1;

      let peer: { name: string; address: string };
      let language: Language;
      if (category === "people") {
        const pool = important
          ? CORRESPONDENTS.slice(0, VIP_COUNT)
          : CORRESPONDENTS.slice(VIP_COUNT);
        const person = rng.pick(pool);
        peer = person;
        language = person.language;
      } else {
        peer = rng.pick(SENDERS[category]);
        language = pickLanguage(rng);
      }
      const suspicious = category === "sign-ins-security" && rng.chance(0.04);
      if (suspicious) peer = SPOOFED_SENDER;

      const age = waiting
        ? (WAITING_AGES_DAYS[t] ?? 1) * DAY
        : important
          ? rng.int(0, 3 * DAY)
          : Math.floor(rng.next() ** 1.6 * YEARS * 365 * DAY);
      const lastInbound = waiting || important || category !== "people" || rng.chance(0.7);
      const gap = rng.int(1, 48) * HOUR;
      const template = TEMPLATES[category][language];
      const baseSubject = rng.pick(template.subjects);
      const baseBody = rng.pick(template.bodies);
      const peerFirst = peer.name.split(" ")[0] ?? peer.name;
      let previousBody = "";
      for (let pos = 0; pos < length; pos++) {
        const fromEnd = length - 1 - pos;
        const inbound = fromEnd % 2 === 0 ? lastInbound : !lastInbound;
        const at = FIXTURE_NOW - age - fromEnd * gap;
        const sender = inbound ? peerFirst : OWNER_NAME;
        let body: string;
        if (pos === 0) body = fill(baseBody, rng, language, at, sender);
        else {
          const quoted = previousBody
            .split("\n")
            .slice(0, 3)
            .map((l) => `> ${l}`);
          body = [rng.pick(REPLIES[language]), "", ...quoted].join("\n");
        }
        previousBody = body;
        const subject = fill(baseSubject, rng, language, at, sender);
        plans.push({
          seq: seq++,
          category,
          language,
          accountIdx,
          threadKey: key,
          pos,
          inbound,
          peer,
          at,
          subject: pos === 0 ? subject : `Re: ${subject}`,
          body,
          opened: !inbound || rng.chance(OPENED_RATE[category]),
          listUnsubscribe:
            inbound &&
            (category === "newsletters" ||
              (category === "promotions" && rng.chance(0.9)) ||
              (category === "notifications" && rng.chance(0.1))),
          attachmentSize: 0,
          suspicious,
          signals: new Set(),
        });
      }
      // The last message of a waiting thread is from them; the first 7 `people` threads are the waiters.
      if (waiting) plans[plans.length - 1]?.signals.add("needs-reply");
      if (important) plans[plans.length - 1]?.signals.add("important-sender");
      if (category === "people" && !waiting && !important && length > 1 && !lastInbound)
        plans[plans.length - 1]?.signals.add("waiting-on-them");
    }
  }
  return plans;
}

function assignSignals(rng: Rng, plans: Plan[], total: number): void {
  // Deadlines this week: the first 3 records messages become recent notices.
  let deadlines = 0;
  for (const plan of plans) {
    if (plan.category !== "records" || deadlines >= MOCK_DATASET.deadlinesThisWeek) continue;
    deadlines++;
    plan.at = FIXTURE_NOW - rng.int(1, 3) * DAY - rng.int(0, 12) * HOUR;
    plan.subject = fill(DEADLINE[plan.language].subject, rng, plan.language, plan.at, "");
    plan.body = fill(DEADLINE[plan.language].body, rng, plan.language, plan.at, "");
    plan.signals.add("time-sensitive");
    plan.opened = false;
  }
  // Documents: a seeded share of records and purchases carry a PDF.
  const documents = Math.round((MOCK_DATASET.documents * total) / MOCK_DATASET.totalMessages);
  const eligible = plans.filter(
    (p) => p.category === "records" || p.category === "purchases-travel",
  );
  for (const plan of rng.shuffle(eligible).slice(0, documents)) {
    plan.attachmentSize = rng.int(150_000, 2_500_000); // Declared size; the PDF body stays a stub (#114).
    plan.signals.add("has-document");
  }
  // Old and never opened: only bulk senders, where this is what makes a clean-up proposal safe.
  for (const plan of plans) {
    const bulk = ["notifications", "newsletters", "promotions"].includes(plan.category);
    if (bulk && !plan.opened && FIXTURE_NOW - plan.at > 2 * 365 * DAY)
      plan.signals.add("old-never-opened");
  }
}

function suggestionFor(plan: Plan): MessageLabel["expectedSuggestion"] {
  const cleanable = ["notifications", "newsletters", "promotions"].includes(plan.category);
  if (!cleanable) return null;
  if (plan.listUnsubscribe && !plan.opened && plan.category !== "notifications")
    return "unsubscribe";
  return plan.signals.has("old-never-opened") ? "archive" : null;
}

function renderMessage(
  plan: Plan,
  owner: { address: string },
  ids: { messageId: string; threadId: string; parentId: string | null; rootId: string },
  rng: Rng,
): string {
  const ownerAddress = owner.address;
  const from = plan.inbound ? plan.peer : { name: OWNER_NAME, address: ownerAddress };
  const to = plan.inbound ? { name: OWNER_NAME, address: ownerAddress } : plan.peer;

  const fits = (text: string) => [...text].every((c) => c.charCodeAt(0) <= 0xff);
  const textAll = `${plan.subject}${plan.body}${from.name}${to.name}`;
  const asciiOnly = /^[\x20-\x7e\n]*$/.test(textAll);
  const charset: Charset =
    plan.language === "fr" && fits(textAll) && rng.chance(0.4) ? "iso-8859-1" : "utf-8";
  const display = (p: { name: string; address: string }) => {
    const name = encodeHeaderText(
      p.name,
      charset === "iso-8859-1" && fits(p.name) ? charset : "utf-8",
    );
    return `${name} <${p.address}>`;
  };
  const date = new Date(plan.at).toUTCString();
  const [weekday = "", day = "", month = "", year = "", time = ""] = date
    .replace(",", "")
    .split(" ");

  const bodyText = `${plan.body}\n`;
  const textHeaders = asciiOnly
    ? ["Content-Type: text/plain; charset=us-ascii", "Content-Transfer-Encoding: 7bit"]
    : plan.language === "ja"
      ? [`Content-Type: text/plain; charset=utf-8`, "Content-Transfer-Encoding: base64"]
      : [
          `Content-Type: text/plain; charset=${charset}`,
          "Content-Transfer-Encoding: quoted-printable",
        ];
  const encodedBody = asciiOnly
    ? quoteFromLines(bodyText)
    : plan.language === "ja"
      ? encodeBase64Body(new TextEncoder().encode(bodyText))
      : quoteFromLines(encodeQuotedPrintable(bodyText, charset));

  const headers = [
    `From: ${display(from)}`,
    `To: ${display(to)}`,
    `Subject: ${encodeHeaderText(plan.subject, charset === "iso-8859-1" ? charset : "utf-8")}`,
    `Date: ${date}`,
    `Message-ID: <${ids.messageId}>`,
    ...(ids.parentId
      ? [`In-Reply-To: <${ids.parentId}>`, `References: <${ids.rootId}> <${ids.parentId}>`]
      : []),
    `X-Thread-Id: ${ids.threadId}`,
    ...(plan.listUnsubscribe
      ? [
          `List-Unsubscribe: <mailto:unsubscribe@${plan.peer.address.split("@")[1]}>, <https://${plan.peer.address.split("@")[1]}/u/${ids.messageId}>`,
          "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
        ]
      : []),
    `Status: ${plan.opened ? "RO" : "O"}`,
    "MIME-Version: 1.0",
  ];

  const separator = `From ${from.address} ${weekday.slice(0, 3)} ${month} ${day} ${time} ${year}`;
  if (!plan.attachmentSize)
    return [separator, ...headers, ...textHeaders, "", encodedBody, "", ""].join("\n");

  const boundary = `fixture-${ids.messageId.split("@")[0]}`;
  const filename = `${plan.category === "records" ? "statement" : "receipt"}-${ids.messageId.split("-").pop()?.split("@")[0]}.pdf`;
  const pdf = new TextEncoder().encode(
    `%PDF-1.4\n% fixture document for ${ids.messageId}\n%%EOF\n`,
  );
  return [
    separator,
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textHeaders,
    "",
    encodedBody,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"; size=${plan.attachmentSize}`,
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Body(pdf),
    `--${boundary}--`,
    "",
    "",
  ].join("\n");
}

/**
 * Same options, byte-identical output. Nothing here reads the clock, the environment or
 * `Math.random`.
 */
export function generateMailbox(options: { seed: number; scale: MailboxScale }): GeneratedMailbox {
  const total = MAILBOX_SCALES[options.scale];
  const rng = createRng(options.seed);
  const plans = planAll(rng, total);
  assignSignals(rng, plans, total);
  plans.sort((a, b) => a.at - b.at || a.seq - b.seq);

  // Ids follow delivery order, per account.
  const counters = [0, 0];
  const threadIds = new Map<number, string>();
  const threadLast = new Map<number, string>();
  const threadRoot = new Map<number, string>();
  const mboxParts: string[][] = [[], []];
  const labels: MessageLabel[] = [];

  for (const plan of plans) {
    const def = ACCOUNT_DEFS[plan.accountIdx] as (typeof ACCOUNT_DEFS)[number];
    const n = (counters[plan.accountIdx] ?? 0) + 1;
    counters[plan.accountIdx] = n;
    const messageId = `fx-${def.short}-${String(n).padStart(6, "0")}@${MESSAGE_ID_DOMAIN}`;
    let threadId = threadIds.get(plan.threadKey);
    if (!threadId) {
      threadId = `thr-${def.short}-${String(threadIds.size + 1).padStart(6, "0")}`;
      threadIds.set(plan.threadKey, threadId);
      threadRoot.set(plan.threadKey, messageId);
    }
    const parentId = threadLast.get(plan.threadKey) ?? null;
    threadLast.set(plan.threadKey, messageId);
    mboxParts[plan.accountIdx]?.push(
      renderMessage(
        plan,
        def,
        { messageId, threadId, parentId, rootId: threadRoot.get(plan.threadKey) ?? messageId },
        rng,
      ),
    );
    labels.push({
      messageId,
      accountId: def.id,
      threadId,
      category: plan.category,
      signals: [...plan.signals].sort(),
      language: plan.language,
      suspicious: plan.suspicious,
      expectedSuggestion: suggestionFor(plan),
    });
  }

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, labels.filter((l) => l.category === c).length]),
  ) as LabelsFile["totals"]["byCategory"];
  const file: LabelsFile = {
    schemaVersion: 1,
    seed: options.seed,
    scale: options.scale,
    totals: {
      messages: labels.length,
      documents: labels.filter((l) => l.signals.includes("has-document")).length,
      attachmentBytes: plans.reduce((sum, p) => sum + p.attachmentSize, 0),
      byCategory,
    },
    messages: labels,
  };
  return {
    workspaceId: FIXTURE_WORKSPACE_ID,
    accounts: ACCOUNT_DEFS.map((def, i) => ({
      id: def.id,
      provider: def.provider,
      address: def.address,
      mbox: (mboxParts[i] ?? []).join(""),
    })),
    labels: labelsFileSchema.parse(file),
  };
}
