import type { Storage } from "@pochimail/db/open-storage";
import { createSqliteSettingsRepository } from "@pochimail/db/sqlite-settings-repository";
import { ok } from "@pochimail/kernel/result";
import { normalizeSettings, type SettingsStore } from "../shared/settings.ts";

/** Settings kept in the encrypted database. Rows from older builds read through `normalizeSettings`. */
export const createSqliteSettingsStore = (storage: Storage): SettingsStore => {
  const repository = createSqliteSettingsRepository(storage);
  return {
    get: async (workspaceId) => {
      const stored = await repository.get(workspaceId);
      return stored.ok ? ok(normalizeSettings(stored.value)) : stored;
    },
    save: (workspaceId, settings) => repository.save(workspaceId, settings),
  };
};
