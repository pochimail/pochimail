import { createFakeLlmProvider } from "@pochimail/classification/testing/fake-ai";
import { live } from "@pochimail/classification/testing/samples";
import { describe, expect, it } from "vitest";
import { type DeadlineInput, extractDeadline, MAX_TEXT_CHARS } from "./deadline-extraction.ts";

const input = (text: string): DeadlineInput => ({
  type: "purchases-travel",
  signals: ["shipping"],
  received: "2027-02-20",
  text,
});

const ask = async (text: string, answer: string, received = "2027-02-20") => {
  const llm = createFakeLlmProvider();
  llm.reply(answer);
  const out = await extractDeadline(llm, { ...input(text), received }, live());
  return { out, prompt: llm.prompts()[0] ?? "" };
};

describe("extractDeadline", () => {
  // Guards: a date the model got right being dropped in one of the three languages.
  it.each([
    ["English", "Your order arrives on March 3. Track it here.", "2027-03-03"],
    ["French", "Votre facture est à régler avant le 3 mars.", "2027-03-03"],
    ["Japanese", "ご注文の商品は12月5日にお届けします。", "2027-12-05"],
    ["numeric", "Check-in: 5/12", "2027-12-05"],
  ])("keeps a %s date the text contains", async (_language, text, date) => {
    const { out } = await ask(text, `{"deadline":"${date}"}`);
    expect(out).toEqual({ ok: true, value: date });
  });

  // Guards: models invent deadlines (ADR 0006 known limits); a date absent from the source must not become a deadline.
  it.each([
    ["a date the text does not contain", "Thanks, talk soon!", '{"deadline":"2027-03-03"}'],
    ["the right day in another month", "Due on 3 April.", '{"deadline":"2027-03-03"}'],
    ["an impossible date", "Due on 31 February.", '{"deadline":"2027-02-31"}'],
  ])("answers no date for %s", async (_name, text, answer) => {
    const { out } = await ask(text, answer);
    expect(out).toEqual({ ok: true, value: null });
  });

  // Guards: a "no date" answer turned into a date.
  it("passes a null deadline through", async () => {
    const { out } = await ask("Thanks, talk soon!", '{"deadline":null}');
    expect(out).toEqual({ ok: true, value: null });
  });

  // Guards: an unparsable answer becoming a deadline, or a model error being swallowed.
  it("reports invalid_output for an answer that is not a date", async () => {
    const { out } = await ask("Due 3 March.", '{"deadline":"next Tuesday"}');
    expect(out.ok ? undefined : out.error.code).toBe("ai.invalid_output");
  });

  // Guards: the text coming before what the cheaper layers already know (minimum input first).
  it("puts the type and signals before the text", async () => {
    const { prompt } = await ask("Due 3 March.", '{"deadline":null}');
    expect(prompt.indexOf("Type: purchases-travel")).toBe(0);
    expect(prompt.indexOf("Signals: shipping")).toBeLessThan(prompt.indexOf("Due 3 March."));
  });

  // Guards: a 10k-character email overflowing the 2048-token context, and the model being asked about text it never saw.
  it("sends only the first characters of a long email, and ignores a date past them", async () => {
    const long = `Due 3 March. ${"x".repeat(10_000)} Also 9 April.`;
    const { prompt } = await ask(long, '{"deadline":"2027-03-03"}');
    expect(prompt.length).toBeLessThan(MAX_TEXT_CHARS + 200);
    const past = await ask(long, '{"deadline":"2027-04-09"}');
    expect(past.out).toEqual({ ok: true, value: null });
  });

  // Guards: "January 5" in a December mail becoming a date a year in the past.
  it.each([
    [
      "moves a yearless date far behind the mail to the next year",
      "Offer ends January 5.",
      "2027-01-05",
      "2027-12-20",
      "2028-01-05",
    ],
    [
      "keeps a date a few days behind the mail",
      "Paid on 18 December.",
      "2027-12-18",
      "2027-12-20",
      "2027-12-18",
    ],
    [
      "keeps a year the text writes",
      "Expired January 5, 2027.",
      "2027-01-05",
      "2027-12-20",
      "2027-01-05",
    ],
  ])("%s", async (_name, text, answered, received, expected) => {
    const { out } = await ask(text, `{"deadline":"${answered}"}`, received);
    expect(out).toEqual({ ok: true, value: expected });
  });
});
