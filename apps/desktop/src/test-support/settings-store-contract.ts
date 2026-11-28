import type { WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { type AppSettings, DEFAULT_APP_SETTINGS, type SettingsStore } from "../shared/settings.ts";

const WS_1 = "ws-1" as WorkspaceId;
const WS_2 = "ws-2" as WorkspaceId;

const settingsStoreChecks: readonly Check<SettingsStore>[] = [
  check(
    "a workspace that never saved gets the safe defaults (guards Autopilot being on after first run)",
    async (s) => {
      expect(unwrap(await s.get(WS_1))).toEqual(DEFAULT_APP_SETTINGS);
      expect(DEFAULT_APP_SETTINGS.autonomy).toBe("suggest");
      expect(Object.values(DEFAULT_APP_SETTINGS.capabilities).every(Boolean)).toBe(true);
    },
  ),
  check(
    "saved settings are read back and stay inside their workspace (guards one workspace changing another's Autopilot)",
    async (s) => {
      const chosen: AppSettings = {
        ...DEFAULT_APP_SETTINGS,
        autonomy: "autopilot",
        capabilities: { ...DEFAULT_APP_SETTINGS.capabilities, declutter: false },
        notifications: false,
        theme: "dark",
        locale: "ja",
        tidyCadence: "weekly",
        summaryShown: true,
      };
      await s.save(WS_1, chosen);
      expect(unwrap(await s.get(WS_1))).toEqual(chosen);
      expect(unwrap(await s.get(WS_2))).toEqual(DEFAULT_APP_SETTINGS);
    },
  ),
  check(
    "saving twice for one workspace keeps the second value (guards a second save being lost or duplicated)",
    async (s) => {
      await s.save(WS_1, { ...DEFAULT_APP_SETTINGS, autonomy: "autopilot", theme: "dark" });
      const second: AppSettings = { ...DEFAULT_APP_SETTINGS, theme: "light" };
      unwrap(await s.save(WS_1, second));
      expect(unwrap(await s.get(WS_1))).toEqual(second);
    },
  ),
];

/** Contract for any `SettingsStore` (in-memory and SQLite). `make` returns a fresh, empty store. */
export function settingsStoreContract(make: () => SettingsStore | Promise<SettingsStore>): void {
  registerContract("SettingsStore contract", settingsStoreChecks, make);
}
