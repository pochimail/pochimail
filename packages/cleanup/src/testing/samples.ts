import type { CancelSignal } from "@pochimail/kernel/common";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { type Suggestion, SuggestionId } from "../model/suggestion.ts";
import type { MessageFact } from "../ports/mailbox-facts.ts";

// Fake data only: every address is on example.com and every text is invented.

export const WS_A = "ws-a" as WorkspaceId;
export const WS_B = "ws-b" as WorkspaceId;
export const ACCOUNT_1 = "acc-1" as AccountId;
export const idOf = (n: number) => `msg-${n}` as MessageId;

export const makeSuggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  schemaVersion: 1,
  id: unwrap(SuggestionId("sug-1")),
  workspaceId: WS_A,
  accountId: ACCOUNT_1,
  recommendation: { kind: "archive", messageIds: [idOf(1)] },
  reasons: ["Weekly newsletter, never opened"],
  confidence: 0.9,
  state: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** One message to store, with the decision recorded for it. */
export interface SeedRow {
  /** `from` is the provider-side address the adapter ingests; the facts only ever carry its hash. */
  readonly message?: Partial<Omit<MessageFact, "id" | "category" | "senderHash">> & {
    readonly from?: string;
  };
  readonly category?: string;
  readonly reason?: string;
  readonly confidence?: number;
  /** The message has no recorded decision yet; `reason` and `confidence` are then ignored. */
  readonly undecided?: boolean;
  /** Signals the message carries. Adapters that evaluate signals themselves must agree with it. */
  readonly signals?: readonly string[];
  /** Signals raised only because a gate was unsure (ADR 0012): they protect but are never counted. */
  readonly unsureSignals?: readonly string[];
}

/** What a cleanup contract needs to arrange before it runs; each adapter fills it its own way. */
export interface Seeder {
  /** Stores the account once, then each message with its label and decision. Re-seeding keeps its place. */
  seed(rows: Record<number, SeedRow>): Promise<void>;
  /** The types of every event committed so far, in order. */
  eventTypes(): Promise<readonly string[]>;
}

/** A cancel signal that never fires, and one that already has; no runtime globals needed. */
export const live = (): CancelSignal => ({
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
});
