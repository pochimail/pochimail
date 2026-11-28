// Guards: a scan that fails after sign-in leaving no trace in the logs.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { createLogger } from "@pochimail/logger/logger";
import { oauthProviderConfig } from "@pochimail/net/oauth/providers";
import { startFakeOAuthServer } from "@pochimail/testing/fake-oauth-server";
import { loopbackFetch } from "@pochimail/testing/loopback-fetch";
import { afterEach, expect, it, vi } from "vitest";
import type { EventOf } from "../shared/ipc/contract.ts";
import { createAccountsRuntime } from "./accounts-runtime.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("a scan that fails after sign-in logs its error code and cause, and says so to the renderer (guards a silent 'could not finish sorting')", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-sync-fail-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const oauth = await startFakeOAuthServer({ address: "person@example.test" });
  cleanups.push(() => oauth.close());
  const lines: string[] = [];
  const secrets = createInMemorySecretStore();
  const runtime = createAccountsRuntime(
    {
      databasePath: join(dir, "pochimail.db"),
      databaseKey: Buffer.from(randomBytes(32)),
      secrets: Object.assign(secrets, {
        protection: async () => ({ level: "os-keychain" as const, backend: "test" }),
      }),
      openBrowser: async (url) => {
        const consent = await fetch(url, { redirect: "manual" });
        const location = consent.headers.get("location");
        if (location !== null) void fetch(location).catch(() => undefined);
      },
    },
    {
      env: { POCHIMAIL_GOOGLE_CLIENT_ID: "test-client" },
      timer: {
        set: (fn, ms) => {
          const h = setTimeout(fn, ms);
          return () => clearTimeout(h);
        },
      },
      logger: createLogger({
        sink: {
          write: (record) => lines.push(`${record.message} ${JSON.stringify(record.fields)}`),
        },
      }),
      deviceName: () => "Mac",
      classifier: createFakeClassifier(),
      network: {
        oauthConfig: {
          ...oauthProviderConfig("google"),
          authorizeUrl: oauth.authorizeUrl,
          tokenUrl: oauth.tokenUrl,
          revokeUrl: oauth.revokeUrl,
        },
        oauthFetch: loopbackFetch,
        // The Gmail API answers 403 (e.g. not enabled for the project).
        gmailFetch: async () => new Response("{}", { status: 403 }),
      },
    },
  );
  if (runtime === undefined) throw new Error("the runtime did not open");
  cleanups.push(() => runtime.close());
  const events: EventOf<"app.events">[] = [];
  runtime.handlers.subscriptions["app.events"]?.(undefined, (event) => events.push(event));

  const outcome = await runtime.handlers.procedures["accounts.connect"]?.({ provider: "google" });
  expect(outcome?.status).toBe("connected");
  await runtime.idle();
  await vi.waitFor(() => expect(events.some((e) => e.type === "ScanFailed")).toBe(true));
  expect(
    lines.some(
      (l) =>
        l.includes("scan failed") &&
        l.includes("provider.failed") &&
        l.includes("Gmail answered 403"),
    ),
  ).toBe(true);
});
