import { z } from "zod";

/**
 * The one message main sends the worker about its window (ADR 0004: polling follows it): one way, no reply, no
 * channel of its own. It carries a state word and nothing else.
 */
const windowActivityMessage = z.object({
  type: z.literal("window-activity"),
  state: z.enum(["focused", "visible", "hidden"]),
});

export type WindowActivityMessage = z.infer<typeof windowActivityMessage>;

/** The message, or `undefined` for anything that is not exactly it: a bad or unknown message is dropped. */
export const parseWindowActivityMessage = (data: unknown): WindowActivityMessage | undefined => {
  const parsed = windowActivityMessage.safeParse(data);
  return parsed.success ? parsed.data : undefined;
};
