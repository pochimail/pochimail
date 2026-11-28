import { z } from "zod";
import { versionSchema } from "../../shared/update-calls.ts";

const latestFileSchema = z.object({ version: versionSchema });

/** The version in a `latest.json` body, or undefined for anything that is not exactly a plain `x.y.z`. */
export const parseLatestVersion = (text: string): string | undefined => {
  try {
    const parsed = latestFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.version : undefined;
  } catch {
    return undefined;
  }
};

const parts = (version: string): number[] | undefined =>
  versionSchema.safeParse(version).success ? version.split(".").map(Number) : undefined;

/** Semver order of plain `x.y.z` versions. Anything else is never newer. */
export const isNewer = (candidate: string, current: string): boolean => {
  const a = parts(candidate);
  const b = parts(current);
  if (a === undefined || b === undefined) return false;
  for (const [i, value] of a.entries()) {
    const other = b[i] ?? 0;
    if (value !== other) return value > other;
  }
  return false;
};
