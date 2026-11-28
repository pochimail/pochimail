import { readFileSync } from "node:fs";
import { z } from "zod";
import { versionSchema } from "../../shared/update-calls.ts";
import { writeFileAtomic } from "../atomic-write.ts";

export type UpdatePrefs = {
  readonly autoCheck: boolean;
  /** The newest version whose toast the person dismissed; a later version shows it again. */
  readonly dismissedVersion: string | null;
};

export interface UpdatePreferences {
  load(): UpdatePrefs;
  /** May throw when the disk refuses. */
  save(prefs: UpdatePrefs): void;
}

const fileSchema = z.object({
  autoCheck: z.boolean().default(true),
  dismissedVersion: versionSchema.nullable().default(null),
});

const DEFAULTS: UpdatePrefs = { autoCheck: true, dismissedVersion: null };

/** Two small preferences in one JSON file in the app's data folder. A missing or damaged file means the defaults. */
export const createUpdatePreferences = (file: string): UpdatePreferences => ({
  load: () => {
    try {
      return fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return DEFAULTS;
    }
  },
  save: (prefs) => writeFileAtomic(file, JSON.stringify(prefs)),
});
