// Guards: a settings patch overwriting fields it does not name, and a legacy stored row breaking the screen.
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { USER_LOCALES } from "@pochimail/ui/i18n/messages.ts";
import { expect, it } from "vitest";
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  SETTINGS_LOCALES,
  type SettingsStore,
} from "../shared/settings.ts";
import { settingsStoreContract } from "../test-support/settings-store-contract.ts";
import { createInMemorySettingsStore } from "./in-memory-settings-store.ts";
import { ManageSettings } from "./manage-settings.ts";

settingsStoreContract(createInMemorySettingsStore);

const WS = "ws-1" as WorkspaceId;

/** A store that still holds a row written before autonomy and capabilities existed. */
const legacyStore = (row: unknown): SettingsStore & { saved: () => unknown } => {
  let current = row;
  return {
    saved: () => current,
    get: async () => ({ ok: true, value: current as AppSettings }),
    save: async (_ws, settings) => {
      current = settings;
      return { ok: true, value: undefined };
    },
  };
};

it("a legacy autopilot:true row reads as Autopilot with every capability on (guards an undefined autonomy crashing settings.get)", async () => {
  const settings = new ManageSettings({
    store: legacyStore({ autopilot: true, notifications: false }),
  });
  const read = unwrap(await settings.get(WS));
  expect(read.autonomy).toBe("autopilot");
  expect(read.notifications).toBe(false);
  expect(Object.values(read.capabilities)).toEqual([true, true, true, true]);
});

it("a legacy autopilot:false row reads as Suggest (guards the safe default being lost)", async () => {
  const settings = new ManageSettings({
    store: legacyStore({ autopilot: false, notifications: true }),
  });
  expect(unwrap(await settings.get(WS)).autonomy).toBe("suggest");
});

it("updating a legacy row never persists an undefined field (guards a half-migrated row)", async () => {
  const store = legacyStore({ autopilot: false, notifications: true });
  await new ManageSettings({ store }).update(WS, { notifications: false });
  expect(store.saved()).toEqual({
    autonomy: "suggest",
    capabilities: {
      "catch-what-matters": true,
      declutter: true,
      organize: true,
      "save-documents": true,
    },
    notifications: false,
    theme: DEFAULT_APP_SETTINGS.theme,
    locale: DEFAULT_APP_SETTINGS.locale,
  });
});

// Guards: a settings locale that the i18n catalogs cannot render, or a duplicated locale list drifting.
it("accepts exactly the shipped UI locales and falls back on anything else", async () => {
  expect(SETTINGS_LOCALES).toEqual(USER_LOCALES);
  const settings = new ManageSettings({ store: createInMemorySettingsStore() });
  for (const locale of USER_LOCALES) {
    const updated = unwrap(await settings.update(WS, { locale }));
    expect(updated.locale).toBe(locale);
  }
  const store = legacyStore({ locale: "de" });
  expect(unwrap(await new ManageSettings({ store }).get(WS)).locale).toBe(
    DEFAULT_APP_SETTINGS.locale,
  );
});
