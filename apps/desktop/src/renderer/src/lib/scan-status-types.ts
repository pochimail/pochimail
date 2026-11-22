import type { EventOf, OutputOf } from "#shared/ipc/contract.ts";

/** One live worker scan job, as returned by `scan.status`. */
export type ScanJob = OutputOf<"scan.status">[number];

/** One per-account progress event, as pushed by `scan.progress`. */
export type ScanProgressEvent = EventOf<"scan.progress">;
