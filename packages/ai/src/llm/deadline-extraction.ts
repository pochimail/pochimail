import type { JsonLlmError, JsonLlmProvider } from "@pochimail/classification/ports/json-llm";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { ok } from "@pochimail/kernel/result";
import { z } from "zod";

// The date shape is checked by `refine`, which the JSON schema leaves out: with node-llama-cpp 3.22.3 a grammar built from
// `anyOf: [{type: "string", pattern}, {type: "null"}]` makes the model answer null every time, while `type: ["string", "null"]` works.
export const deadlineSchema = z.object({
  deadline: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .nullable(),
});

export interface DeadlineInput {
  /** What the cheaper layers already decided and saw: they come before the text so a short prompt can stop there. */
  readonly type: string;
  readonly signals: readonly string[];
  /** Day the message arrived, `YYYY-MM-DD`: a date written without a year is read against it. */
  readonly received: string;
  readonly text: string;
}

/**
 * Characters of the email the model reads. The context is 2048 tokens and holds the system prompt, the answer and this
 * text; a thousand characters is under ~1500 tokens in every script we support, and the deadline sits near the top.
 */
export const MAX_TEXT_CHARS = 1000;

const systemPrompt = (year: string): string =>
  `You read one email (English, French or Japanese) and extract its deadline: the date by which the reader must act, or on which an offer, delivery or check-in falls.
A date written without a year is its next occurrence on or after the Received date.
Answer {"deadline":"YYYY-MM-DD"}, or {"deadline":null} when the text states no date. Never invent a date the text does not state.
Example: "Votre facture est à régler avant le 3 mars." -> {"deadline":"${year}-03-03"}
Example: "ご注文の商品は12月5日にお届けします。" -> {"deadline":"${year}-12-05"}
Example: "Thanks for your message, talk soon!" -> {"deadline":null}
Answer with JSON only.`;

const prompt = ({ type, signals, received, text }: DeadlineInput): string =>
  `Type: ${type}\nSignals: ${signals.join(", ") || "none"}\nReceived: ${received}\n\nText:\n${text}`;

const monthNames = (month: number): string[] =>
  ["en", "fr"].flatMap((locale) =>
    (["long", "short"] as const).map((style) =>
      new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" })
        .format(Date.UTC(2027, month - 1, 1))
        .toLowerCase()
        .replace(/\.$/, ""),
    ),
  );

/** A date the model returns must be written in the source: its day and month as numbers (`3/4`, `3月4日`) or as a month name. */
export const dateAppearsIn = (date: string, text: string): boolean => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return false;
  const numbers = (text.match(/\d+/g) ?? []).map(Number);
  const seen = (n: number): number => numbers.filter((x) => x === n).length;
  if (seen(day) === 0) return false;
  if (seen(month) > (month === day ? 1 : 0)) return true;
  const lower = text.toLowerCase();
  return monthNames(month).some((name) =>
    new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, "u").test(lower),
  );
};

const DAY_MS = 86_400_000;

/**
 * A date written without a year is read against the day the message arrived. The model may still put it in the
 * received year ("January 5" in a December mail): a year the text does not write and a date far in the past of the mail
 * can only mean the next one.
 */
const nextOccurrence = (date: string, received: string, text: string): string => {
  const [year] = date.split("-");
  if (text.includes(year as string)) return date;
  const pastDays = (Date.parse(received) - Date.parse(date)) / DAY_MS;
  return pastDays > 180 ? `${Number(year) + 1}${date.slice(4)}` : date;
};

/** The deadline in the text, or `null` when there is none or the model named a date the text does not contain. */
export const extractDeadline = async (
  llm: JsonLlmProvider,
  input: DeadlineInput,
  signal: CancelSignal,
): AsyncResult<string | null, JsonLlmError> => {
  const text = input.text.slice(0, MAX_TEXT_CHARS);
  const answered = await llm.completeJson(
    {
      system: systemPrompt(input.received.slice(0, 4)),
      prompt: prompt({ ...input, text }),
      maxTokens: 64,
      schema: deadlineSchema,
    },
    signal,
  );
  if (!answered.ok) return answered;
  const { deadline } = answered.value;
  if (deadline === null || !dateAppearsIn(deadline, text)) return ok(null);
  return ok(nextOccurrence(deadline, input.received, text));
};
