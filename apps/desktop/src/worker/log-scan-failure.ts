import type { DomainError } from "@pochimail/kernel/errors";
import type { Logger } from "@pochimail/logger/logger";

const MAX_CAUSE_CHARS = 200;

/** One line per failed scan with its error code and what went wrong, so a scan that fails after sign-in can be diagnosed. */
export const logScanFailure = (logger: Logger, error: DomainError): void => {
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const detail =
    cause === undefined ? "" : `: ${cause.name}: ${cause.message}`.slice(0, MAX_CAUSE_CHARS);
  logger.error(`scan failed (${error.message})${detail}`, { operation: "scan", code: error.code });
};
