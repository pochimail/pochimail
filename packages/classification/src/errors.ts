import { DomainError } from "@pochimail/kernel/errors";

/** The local model is missing, still loading or crashed. */
export class AiUnavailable extends DomainError {
  constructor(message = "Local AI is unavailable") {
    super("ai.unavailable", message);
  }
}

/** The model answered, but not with what the schema allows. Never a guess: the caller gets no value. */
export class AiInvalidOutput extends DomainError {
  constructor(message = "Local AI output did not match the schema") {
    super("ai.invalid_output", message);
  }
}
