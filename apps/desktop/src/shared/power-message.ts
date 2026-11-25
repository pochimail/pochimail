import { THERMAL_STATES } from "@pochimail/pipeline/power-monitor";
import { z } from "zod";

/**
 * The one message from main to the worker about the machine's power (ADR 0002): the whole state, every time, with no reply.
 * It carries no mail data. The worker drops anything that does not parse.
 */
export const powerMessageSchema = z.object({
  type: z.literal("power"),
  state: z.object({
    onBattery: z.boolean(),
    thermal: z.enum(THERMAL_STATES),
    online: z.boolean(),
    asleep: z.boolean(),
    batterySaver: z.boolean(),
  }),
});
export type PowerMessage = z.infer<typeof powerMessageSchema>;
