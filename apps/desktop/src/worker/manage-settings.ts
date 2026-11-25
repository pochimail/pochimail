import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { z } from "zod";
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  normalizeSettings,
  type SettingsStore,
} from "../shared/settings.ts";

type Patch = { readonly [K in keyof AppSettings]?: AppSettings[K] | undefined };

/** A stored row that could not be parsed, as opposed to a database that could not be read. */
const isUnreadableRow = (error: StorageError): boolean =>
  error.cause instanceof SyntaxError || error.cause instanceof z.ZodError;

/**
 * Reads and patches the workspace settings; a patch only changes the fields it names.
 * Updates for one workspace run one at a time, so overlapping patches never overwrite each other's fields.
 */
export class ManageSettings {
  private readonly queues = new Map<WorkspaceId, Promise<unknown>>();

  constructor(private readonly deps: { readonly store: SettingsStore }) {}

  async get(workspaceId: WorkspaceId): AsyncResult<AppSettings, StorageError> {
    const stored = await this.deps.store.get(workspaceId);
    return stored.ok ? ok(normalizeSettings(stored.value)) : stored;
  }

  update(workspaceId: WorkspaceId, patch: Patch): AsyncResult<AppSettings, StorageError> {
    const run = (this.queues.get(workspaceId) ?? Promise.resolve()).then(() =>
      this.apply(workspaceId, patch),
    );
    // A rejected update must not block the next one.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(workspaceId, tail);
    void tail.then(() => {
      if (this.queues.get(workspaceId) === tail) this.queues.delete(workspaceId);
    });
    return run;
  }

  private async apply(
    workspaceId: WorkspaceId,
    patch: Patch,
  ): AsyncResult<AppSettings, StorageError> {
    const read = await this.get(workspaceId);
    // A row that cannot be parsed would block every save for good, so it is replaced from the defaults.
    if (!read.ok && !isUnreadableRow(read.error)) return read;
    const current = read.ok ? read.value : DEFAULT_APP_SETTINGS;
    const next: AppSettings = {
      autonomy: patch.autonomy ?? current.autonomy,
      capabilities: patch.capabilities ?? current.capabilities,
      notifications: patch.notifications ?? current.notifications,
      theme: patch.theme ?? current.theme,
      locale: patch.locale !== undefined ? patch.locale : current.locale,
      tidyCadence: patch.tidyCadence ?? current.tidyCadence,
      summaryShown: patch.summaryShown ?? current.summaryShown,
    };
    const saved = await this.deps.store.save(workspaceId, next);
    return saved.ok ? ok(next) : saved;
  }
}
