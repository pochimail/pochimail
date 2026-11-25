import { PROVIDER_KINDS } from "@pochimail/accounts/model/account";
import { ACTION_KINDS } from "@pochimail/actions/model/action";
import { CATEGORIES, SIGNAL_KINDS } from "@pochimail/classification/model/category";
import { RECOMMENDATION_KINDS } from "@pochimail/cleanup/model/suggestion";
import { fakeSenderHash } from "@pochimail/kernel/testing/fake-sender-hash";

// Fake data only: every address is on example.com, every text is invented.

/** Small seeded PRNG (mulberry32) so property-style samples are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    bool: () => next() < 0.5,
  };
}
type Rng = ReturnType<typeof rng>;

const WORDS = ["weekly", "invoice", "meeting", "trip", "offer", "update", "résumé", "日本語", "ça"];
const id = (r: Rng, p: string) => `${p}-${r.int(1e6)}`;
const addr = (r: Rng) => `person${r.int(1e4)}@example.com`;
const ts = (r: Rng) => new Date(Date.UTC(2020, 0, 1) + r.int(1e9) * 1000).toISOString();
const text = (r: Rng) => Array.from({ length: 1 + r.int(5) }, () => r.pick(WORDS)).join(" ");
const confidence = (r: Rng) => (r.bool() ? r.pick([0, 1]) : r.next());
const reasons = (r: Rng) => Array.from({ length: 1 + r.int(3) }, () => text(r));
const base = (r: Rng) => ({ schemaVersion: 1, workspaceId: id(r, "w") });
const command = (r: Rng) => ({
  kind: r.pick(ACTION_KINDS),
  messageIds: Array.from({ length: 1 + r.int(3) }, () => id(r, "m")),
  ...(r.bool() ? { label: text(r) } : {}),
});

export const sampleBuilders = {
  account: (r: Rng) => ({
    ...base(r),
    id: id(r, "a"),
    provider: r.pick(PROVIDER_KINDS),
    address: addr(r),
    connectedAt: ts(r),
    grantedScopes: r.bool() ? ["gmail.readonly"] : [],
  }),
  incomingMessage: (r: Rng) => ({
    ...base(r),
    id: id(r, "m"),
    accountId: id(r, "a"),
    threadId: id(r, "t"),
    from: addr(r),
    to: Array.from({ length: r.int(3) }, () => addr(r)),
    subject: text(r),
    snippet: text(r),
    receivedAt: ts(r),
    hasListUnsubscribe: r.bool(),
    opened: r.bool(),
    topicIds: Array.from({ length: r.int(3) }, () => id(r, "topic")),
    ...(r.bool() ? { suspicious: { reasons: reasons(r), confidence: confidence(r) } } : {}),
  }),
  message: (r: Rng) => {
    const incoming = sampleBuilders.incomingMessage(r);
    return {
      ...incoming,
      category: r.pick(CATEGORIES),
      senderHash: fakeSenderHash(incoming.accountId, incoming.from),
    };
  },
  thread: (r: Rng) => ({
    ...base(r),
    id: id(r, "t"),
    accountId: id(r, "a"),
    subject: text(r),
    messageIds: Array.from({ length: 1 + r.int(4) }, () => id(r, "m")),
    lastMessageAt: ts(r),
  }),
  senderStats: (r: Rng) => ({
    ...base(r),
    accountId: id(r, "a"),
    address: addr(r),
    messageCount: r.int(1000),
    openedCount: r.int(1000),
    repliedCount: r.int(100),
    lastMessageAt: ts(r),
    vip: r.bool(),
  }),
  attachment: (r: Rng) => ({
    ...base(r),
    id: id(r, "att"),
    messageId: id(r, "m"),
    filename: `${text(r)}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: r.int(1e7),
    sha256: Array.from({ length: 64 }, () => r.int(16).toString(16)).join(""),
  }),
  topic: (r: Rng) => ({ ...base(r), id: id(r, "topic"), name: text(r) }),
  signal: (r: Rng) => ({
    ...base(r),
    messageId: id(r, "m"),
    kind: r.pick(SIGNAL_KINDS),
    confidence: confidence(r),
    detectedAt: ts(r),
  }),
  suggestion: (r: Rng) => ({
    ...base(r),
    id: id(r, "s"),
    accountId: id(r, "a"),
    recommendation: { ...command(r), kind: r.pick(RECOMMENDATION_KINDS) },
    reasons: reasons(r),
    confidence: confidence(r),
    state: r.pick(["pending", "approved", "dismissed"]),
    createdAt: ts(r),
  }),
  action: (r: Rng) => ({
    ...base(r),
    id: id(r, "act"),
    ...(r.bool() ? { suggestionId: id(r, "s") } : {}),
    idempotencyKey: id(r, "key"),
    command: command(r),
    createdAt: ts(r),
  }),
  actionLog: (r: Rng) => {
    const cmd = command(r);
    const irreversible = cmd.kind === "unsubscribe" && r.bool();
    return {
      ...base(r),
      id: id(r, "log"),
      actionId: id(r, "act"),
      idempotencyKey: id(r, "key"),
      outcome: irreversible ? "applied" : r.pick(["applied", "undone"]),
      command: cmd,
      inverse: irreversible ? null : command(r),
      irreversible,
      ...(irreversible ? { irreversibleReason: "an unsubscribe request cannot be recalled" } : {}),
      ...(r.bool() ? { errorCode: "provider.offline" } : {}),
      at: ts(r),
    };
  },
} as const;
