// Guards: theme, language and autonomy resetting to the defaults every time the worker starts.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { createLogger } from "@pochimail/logger/logger";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "../shared/settings.ts";
import { createAccountsRuntime } from "./accounts-runtime.ts";
import { ALWAYS_VISIBLE } from "./static-environment.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

it("a worker reopened on the same database finds theme, language and autonomy unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-settings-worker-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "pochimail.db");
  const key = randomBytes(32);
  const start = () => {
    const runtime = createAccountsRuntime(
      {
        databasePath,
        databaseKey: Buffer.from(key),
        secrets: Object.assign(createInMemorySecretStore(), {
          protection: async () => ({ level: "os-keychain" as const, backend: "test" }),
        }),
        openBrowser: async () => undefined,
      },
      {
        env: {},
        timer: { set: () => () => undefined },
        logger: createLogger({ sink: { write: () => undefined } }),
        deviceName: () => "Mac",
        activity: ALWAYS_VISIBLE,
        classifier: createFakeClassifier(),
      },
    );
    if (runtime === undefined) throw new Error("the runtime did not open");
    return runtime;
  };

  const first = start();
  expect(await first.handlers.procedures["settings.get"]?.(undefined)).toEqual(
    DEFAULT_APP_SETTINGS,
  );
  await first.handlers.procedures["settings.update"]?.({
    theme: "dark",
    locale: "ja",
    autonomy: "autopilot",
  });
  await first.close();

  const second = start();
  cleanups.push(() => second.close());
  expect(await second.handlers.procedures["settings.get"]?.(undefined)).toMatchObject({
    theme: "dark",
    locale: "ja",
    autonomy: "autopilot",
  });
});
