import type { CancelSignal } from "@pochimail/kernel/common";
import type { AccountId, MessageId, ThreadId, WorkspaceId } from "@pochimail/kernel/ids";
import type { Category } from "../model/category.ts";
import type { DerivedMessage } from "../model/derived.ts";
import type { ClassifiableMessage } from "../model/message-facts.ts";

// Fake data only: every address is on example.com and every text is invented.

export const WS_A = "ws-a" as WorkspaceId;
export const WS_B = "ws-b" as WorkspaceId;
export const ACCOUNT_1 = "acc-1" as AccountId;
export const OWNER_ADDRESS = "owner@example.com";

/** A valid stored message; later numbers are more recent, so ordering assertions read easily. */
export const makeMessage = (
  n: number,
  over: Partial<ClassifiableMessage> = {},
): ClassifiableMessage => ({
  id: `msg-${n}` as MessageId,
  accountId: ACCOUNT_1,
  threadId: `thr-${n}` as ThreadId,
  from: "sender@example.com",
  to: [OWNER_ADDRESS],
  subject: `Subject ${n}`,
  snippet: `Snippet ${n}`,
  receivedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
  hasListUnsubscribe: false,
  opened: false,
  ...over,
});

export const makeDerived = (n: number, over: Partial<DerivedMessage> = {}): DerivedMessage => ({
  schemaVersion: 1,
  workspaceId: WS_A,
  accountId: ACCOUNT_1,
  messageId: `msg-${n}` as MessageId,
  category: "newsletters",
  reason: "Weekly newsletter, never opened",
  confidence: 0.9,
  modelVersion: "rules-1",
  snippet: `Snippet ${n}`,
  derivedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** One message to store with its stored label and derived data. */
export interface SeedRow {
  readonly message?: Partial<ClassifiableMessage>;
  readonly category?: Category;
  /** `null` stores no derived data, as for a message the classifier has not answered yet. */
  readonly derived?: Partial<DerivedMessage> | null;
  /** Attachments the provider reported; left out when it reported none. */
  readonly attachmentCount?: number;
}

/** What the signal rules read about a sender (the mailbox's sender statistics). */
export interface SenderSeed {
  readonly vip?: boolean;
  readonly repliedCount?: number;
}

/** What a contract needs to arrange before it runs; each adapter fills it its own way. */
export interface Seeder {
  /** Stores the account once, then each message with its label and derived data. */
  seed(rows: Record<number, SeedRow>): Promise<void>;
  setSender(address: string, stats: SenderSeed): Promise<void>;
}

/** A cancel signal that never fires, and one that already has; no runtime globals needed. */
export const live = (): CancelSignal => ({
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
});
export const aborted = (): CancelSignal => ({ ...live(), aborted: true });
