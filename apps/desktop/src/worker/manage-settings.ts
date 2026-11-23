import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { type AppSettings, normalizeSettings, type SettingsStore } from "../shared/settings.ts";

/** Reads and patches the workspace settings; a patch only changes the fields it names. */
export class ManageSettings {
  constructor(private readonly deps: { readonly store: SettingsStore }) {}

  async get(workspaceId: WorkspaceId): AsyncResult<AppSettings, StorageError> {
    const stored = await this.deps.store.get(workspaceId);
    return stored.ok ? ok(normalizeSettings(stored.value)) : stored;
  }

  async update(
    workspaceId: WorkspaceId,
    patch: { readonly [K in keyof AppSettings]?: AppSettings[K] | undefined },
  ): AsyncResult<AppSettings, StorageError> {
    const current = await this.get(workspaceId);
    if (!current.ok) return current;
    const next: AppSettings = {
      autonomy: patch.autonomy ?? current.value.autonomy,
      capabilities: patch.capabilities ?? current.value.capabilities,
      notifications: patch.notifications ?? current.value.notifications,
      theme: patch.theme ?? current.value.theme,
      locale: patch.locale !== undefined ? patch.locale : current.value.locale,
      tidyCadence: patch.tidyCadence ?? current.value.tidyCadence,
      summaryShown: patch.summaryShown ?? current.value.summaryShown,
    };
    const saved = await this.deps.store.save(workspaceId, next);
    return saved.ok ? ok(next) : saved;
  }
}
