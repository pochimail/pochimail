import type { DomainEvent } from "@pochimail/workflows/events";

// Fake data only. Cast once: branded IDs are validated by the catalog schema on publish.
const base = (id: string) => ({
  id,
  version: 1 as const,
  workspaceId: "w-1" as never,
  occurredAt: "2026-01-01T00:00:00.000Z",
});

export function sampleEvent(n = 0): DomainEvent {
  return {
    ...base(`evt-${n}`),
    type: "ScanProgressed",
    payload: { accountId: "a-1" as never, processed: n },
  };
}

export function sampleClassified(n = 0): DomainEvent {
  return {
    ...base(`evt-c-${n}`),
    type: "MessageClassified",
    payload: {
      accountId: "a-1" as never,
      messageId: `m-${n}` as never,
      category: "newsletter",
      confidence: 0.9,
    },
  };
}
