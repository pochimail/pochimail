/** Closed set of stable error codes. The logger lets only these through under a `code` key. */
export const ERROR_CODES = [
  "domain.invalid_id",
  "domain.invalid_state",
  "policy.denied",
  "provider.rate_limited",
  "provider.offline",
  "provider.auth_expired",
  "provider.conflict",
  "provider.failed",
  "auth.sign_in_cancelled",
  "auth.invalid_callback",
  "auth.missing_client_config",
  "storage.failed",
  "storage.not_found",
  "ai.unavailable",
  "ai.invalid_output",
  "operation.cancelled",
  "action.outcome_unknown",
  "action.replay_expired",
  "event.invalid",
  "event.handler_failed",
  "event.handler_timeout",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Base of all expected failures. `code` is stable and safe to log; `message` must carry no PII. */
export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidIdError extends DomainError {
  readonly kind: string;

  constructor(kind: string, reason: string) {
    super("domain.invalid_id", `Invalid ${kind}: ${reason}`);
    this.kind = kind;
  }
}

/** A repository, blob store, secret store or queue could not complete the operation. */
export class StorageError extends DomainError {
  constructor(message = "Storage operation failed", options?: { cause?: unknown }) {
    super("storage.failed", message, options);
  }
}

/** The caller's `AbortSignal` fired; the operation stopped and changed nothing further. */
export class Cancelled extends DomainError {
  constructor() {
    super("operation.cancelled", "Operation cancelled");
  }
}

/** The event failed validation against the catalog, so it was not delivered. */
export class EventError extends DomainError {
  constructor(message = "Event is invalid") {
    super("event.invalid", message);
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super("domain.invalid_state", message);
  }
}

/** Failures reported by (or while reaching) a mail provider. */
export abstract class ProviderError extends DomainError {}

export class RateLimited extends ProviderError {
  readonly retryAfterMs: number | undefined;

  constructor(options: { retryAfterMs?: number } = {}) {
    super("provider.rate_limited", "Provider rate limit reached");
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class Offline extends ProviderError {
  constructor() {
    super("provider.offline", "Provider is unreachable");
  }
}

export class AuthExpired extends ProviderError {
  constructor() {
    super("provider.auth_expired", "Provider credentials expired");
  }
}

export class Conflict extends ProviderError {
  constructor(message = "Provider state changed since it was last read") {
    super("provider.conflict", message);
  }
}

/** The provider answered, but not acceptably (a rejected token exchange, an unexpected body). */
export class ProviderFailed extends ProviderError {
  constructor(message = "Provider request failed") {
    super("provider.failed", message);
  }
}

export class NotFound extends DomainError {
  constructor(what: string) {
    super("storage.not_found", `${what} not found`);
  }
}
