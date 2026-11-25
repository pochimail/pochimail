// Guards: a settings store that passes in memory but loses, mixes up or fails to read what the database holds, and a corrupt row blocking every later save.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage, type Storage } from "@pochimail/db/open-storage";
import { createSqliteSettingsRepository } from "@pochimail/db/sqlite-settings-repository";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "../shared/settings.ts";
import { settingsStoreContract } from "../test-support/settings-store-contract.ts";
import { ManageSettings } from "./manage-settings.ts";
import { createSqliteSettingsStore } from "./sqlite-settings-store.ts";

const dirs: string[] = [];
const opened: Storage[] = [];
afterEach(() => {
  for (const storage of opened.splice(0)) storage.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const freshStorage = (): Storage => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-settings-"));
  dirs.push(dir);
  const storage = unwrap(openStorage(join(dir, "pochimail.db"), Buffer.alloc(32, 3)));
  opened.push(storage);
  return storage;
};

settingsStoreContract(() => createSqliteSettingsStore(freshStorage()));

it("a legacy row reads through normalizeSettings (guards normalizeSettings only, not a database migration)", async () => {
  const storage = freshStorage();
  const workspace = "ws-1" as WorkspaceId;
  unwrap(
    await createSqliteSettingsRepository(storage).save(workspace, {
      autopilot: true,
      notifications: false,
    }),
  );
  expect(unwrap(await createSqliteSettingsStore(storage).get(workspace))).toMatchObject({
    autonomy: "autopilot",
    notifications: false,
    theme: "system",
    locale: null,
  });
});

it("a corrupt row is replaced by the next update (guards one bad row blocking settings saves for good)", async () => {
  const storage = freshStorage();
  const workspace = "ws-1" as WorkspaceId;
  storage.writer
    .prepare("INSERT INTO settings (workspace_id, data) VALUES (?, ?)")
    .run(workspace, "{not json");
  const settings = new ManageSettings({ store: createSqliteSettingsStore(storage) });

  expect((await settings.get(workspace)).ok).toBe(false);
  const updated = unwrap(await settings.update(workspace, { autonomy: "autopilot" }));

  expect(updated).toEqual({ ...DEFAULT_APP_SETTINGS, autonomy: "autopilot" });
  expect(unwrap(await settings.get(workspace))).toEqual(updated);
});
