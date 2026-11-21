import { AUTONOMY_LEVELS, type AutonomyLevel } from "@pochimail/actions/policies/autonomy";
import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { USER_LOCALES, type UserLocale } from "@pochimail/ui/i18n/messages.ts";

/** Workspace-wide preferences the Settings screen edits. Defaults are the safe ones: suggest only, counts-only notifications. */
export interface AppSettings {
  /** Brief §2, question 2. */
  readonly autonomy: AutonomyLevel;
  /** Brief §2, question 1: which jobs the assistant may do. All on by default. */
  readonly capabilities: Capabilities;
  readonly notifications: boolean;
  /** Appearance follows the OS until someone chooses Light or Dark. */
  readonly theme: Theme;
  /** UI language: null follows the OS until someone chooses one. */
  readonly locale: UserLocale | null;
}

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
/** One source of truth: the settings choices are exactly the shipped UI locales. */
export const SETTINGS_LOCALES = USER_LOCALES;

export const CAPABILITIES = [
  "catch-what-matters",
  "declutter",
  "organize",
  "save-documents",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
type Capabilities = { readonly [K in Capability]: boolean };

const DEFAULT_CAPABILITIES: Capabilities = {
  "catch-what-matters": true,
  declutter: true,
  organize: true,
  "save-documents": true,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autonomy: "suggest",
  capabilities: DEFAULT_CAPABILITIES,
  notifications: true,
  theme: "system",
  locale: null,
};

export interface SettingsStore {
  /** Returns the defaults until something was saved. */
  get(workspaceId: WorkspaceId): AsyncResult<AppSettings, StorageError>;
  /** Replaces the stored settings. */
  save(workspaceId: WorkspaceId, settings: AppSettings): AsyncResult<void, StorageError>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Turns whatever a store holds into the current shape, never leaving a field undefined. A legacy row
 * `{ autopilot, notifications }` keeps its meaning: `autopilot: true` becomes autonomy "autopilot",
 * anything else falls back to the safe default "suggest".
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const row = isRecord(raw) ? raw : {};
  const autonomy = AUTONOMY_LEVELS.find((level) => level === row["autonomy"]);
  const theme = THEMES.find((value) => value === row["theme"]);
  const locale = SETTINGS_LOCALES.find((value) => value === row["locale"]) ?? null;
  const saved = isRecord(row["capabilities"]) ? row["capabilities"] : {};
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((name) => {
      const value = saved[name];
      return [name, typeof value === "boolean" ? value : DEFAULT_CAPABILITIES[name]];
    }),
  ) as { -readonly [K in Capability]: boolean };
  return {
    autonomy: autonomy ?? (row["autopilot"] === true ? "autopilot" : DEFAULT_APP_SETTINGS.autonomy),
    capabilities,
    notifications:
      typeof row["notifications"] === "boolean"
        ? row["notifications"]
        : DEFAULT_APP_SETTINGS.notifications,
    theme: theme ?? DEFAULT_APP_SETTINGS.theme,
    locale,
  };
}
