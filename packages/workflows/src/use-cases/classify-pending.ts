import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { type DomainError, StorageError } from "@pochimail/kernel/errors";
import type { MessageId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import { createClassifyStages, type ScanPipelineDeps } from "../jobs/scan-pipeline.ts";

export interface ClassifyPendingDeps
  extends Pick<ScanPipelineDeps, "uow" | "classifier" | "clock" | "workspaceId" | "accountId"> {
  /** Messages classified per batch. */
  readonly batchSize?: number;
}

export interface ClassifyPendingReport {
  /** Messages that got a decision in this run. */
  readonly classified: number;
}

const BATCH_SIZE = 100;

/** Only a storage failure is an error; a classifier that is down just ends the run, and the next one retries. */
const fatal = (error: DomainError): error is StorageError => error instanceof StorageError;

/**
 * Gives a type and signals to every stored message of the account that has none: mail that an incremental
 * sync just stored, and what an earlier run left behind (a crash, an unavailable classifier, a pause). It runs
 * the scan's own classify and signals stages, so the classifier limits, power behaviour and events are the scan's.
 */
export class ClassifyPending {
  private readonly stages: ReturnType<typeof createClassifyStages>;

  constructor(private readonly deps: ClassifyPendingDeps) {
    this.stages = createClassifyStages(deps);
  }

  async execute(signal: CancelSignal): AsyncResult<ClassifyPendingReport, StorageError> {
    const attempted = new Set<MessageId>();
    let classified = 0;
    while (!signal.aborted) {
      const listed = await this.deps.uow.reads.messages.listUnclassified(
        this.deps.workspaceId,
        this.deps.accountId,
        this.deps.batchSize ?? BATCH_SIZE,
      );
      if (!listed.ok) return listed;
      // A message the classifier gave no usable answer for is tried once per run, not forever.
      const ids = listed.value.filter((id) => !attempted.has(id));
      if (ids.length === 0) break;
      for (const id of ids) attempted.add(id);

      const done = await this.classify(ids);
      if (!done.ok) return done;
      if (done.value === undefined) break;
      classified += done.value;
    }
    return ok({ classified });
  }

  /** Classes one batch; `undefined` when the classifier could not answer. */
  private async classify(ids: readonly MessageId[]): AsyncResult<number | undefined, StorageError> {
    const decided = await this.stages.classify.process({ ids });
    if (!decided.ok) return fatal(decided.error) ? err(decided.error) : ok(undefined);
    const signals = await this.stages.signals.process(decided.value);
    if (!signals.ok) return fatal(signals.error) ? err(signals.error) : ok(undefined);
    const { uow, workspaceId } = this.deps;
    const now = await uow.reads.derived.listForMessages(workspaceId, ids);
    return now.ok ? ok(now.value.length) : now;
  }
}
