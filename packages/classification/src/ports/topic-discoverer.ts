import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { MessageId } from "@pochimail/kernel/ids";
import type { ClassifiableMessage } from "../model/message-facts.ts";
import type { Topic } from "../model/topic.ts";
import type { AiError } from "./classifier.ts";

/** A topic the model found: a name in the user's language and the messages it covers. */
export interface TopicProposal {
  readonly name: string;
  readonly messageIds: readonly MessageId[];
}

/** Local model only. Output is untrusted: `DiscoverTopics` validates every name and id. */
export interface TopicDiscoverer {
  /**
   * Proposes topics for `messages`. `known` are the topics that already exist, with the names the
   * user sees: an email that belongs to one is proposed under that exact name, so a second scan
   * finds the same topics instead of new ones.
   */
  discover(
    messages: readonly ClassifiableMessage[],
    known: readonly Topic[],
    signal: CancelSignal,
  ): AsyncResult<readonly TopicProposal[], AiError>;
}
