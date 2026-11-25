import type { EmailType } from "@pochimail/classification/model/email-type";
import { ITEMS } from "./content.ts";
import type { Language } from "./content-types.ts";
import type { Rng } from "./prng.ts";

export const DAY = 86_400_000;

// Seeded draws that fill the generator's templates. Each call consumes the generator's random
// stream in a fixed order, so changing one changes every fixture.

export function pickLanguage(rng: Rng): Language {
  const roll = rng.next();
  if (roll < 0.7) return "en";
  return roll < 0.9 ? "fr" : "ja";
}

function amountOf(rng: Rng, language: Language): string {
  if (language === "en") return `USD ${rng.int(5, 900)}.${String(rng.int(0, 99)).padStart(2, "0")}`;
  if (language === "fr") return `${rng.int(5, 900)},${String(rng.int(0, 99)).padStart(2, "0")} EUR`;
  return `${rng.int(500, 90000)}円`;
}

export function fill(text: string, rng: Rng, language: Language, at: number, name: string): string {
  const amount = amountOf(rng, language);
  return text
    .replaceAll("{n}", String(rng.int(100, 99_999)))
    .replaceAll("{name}", name)
    .replaceAll("{item}", rng.pick(ITEMS[language]))
    .replaceAll("{amount}", amount)
    .replaceAll("{date}", new Date(at + rng.int(1, 6) * DAY).toISOString().slice(0, 10));
}

export function threadLength(category: EmailType, rng: Rng): number {
  if (category === "personal") {
    if (rng.chance(0.07)) return rng.int(8, 30);
    return rng.chance(0.35) ? rng.int(2, 4) : 1;
  }
  if (category === "transactional" && rng.chance(0.07)) return rng.int(2, 3);
  return 1;
}
