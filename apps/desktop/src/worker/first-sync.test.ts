// Guards: a connected account that never syncs, a sync that stores mail text, or scan events that never reach the renderer.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { openStorage } from "@pochimail/db/open-storage";
import { createLogger } from "@pochimail/logger/logger";
import { oauthProviderConfig } from "@pochimail/net/oauth/providers";
import { createFakeGmailServer } from "@pochimail/testing/fake-gmail-server";
import { startFakeOAuthServer } from "@pochimail/testing/fake-oauth-server";
import { loopbackFetch } from "@pochimail/testing/loopback-fetch";
import { afterEach, expect, it, vi } from "vitest";
import type { EventOf } from "../shared/ipc/contract.ts";
import { createAccountsRuntime } from "./accounts-runtime.ts";
import { ALWAYS_VISIBLE } from "./static-environment.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const MARKERS = ["SECRET-SUBJECT", "SECRET-SNIPPET"];

it("connecting starts the first scan on the real database, tells the renderer and stores no subject or snippet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-sync-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, "pochimail.db");
  const key = randomBytes(32);

  const oauth = await startFakeOAuthServer({ address: "person@example.test" });
  cleanups.push(() => oauth.close());
  const gmail = createFakeGmailServer();
  for (let n = 1; n <= 3; n += 1) {
    gmail.add({
      id: `m${n}`,
      threadId: `t${n}`,
      receivedAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
      from: "sender@example.test",
      to: ["person@example.test"],
      subject: `${MARKERS[0]} ${n}`,
      snippet: `${MARKERS[1]} ${n}`,
      hasListUnsubscribe: false,
      opened: false,
    });
  }

  const secrets = createInMemorySecretStore();
  const handedKey = Buffer.from(key);
  const runtime = createAccountsRuntime(
    {
      databasePath,
      databaseKey: handedKey,
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
      logger: createLogger({ sink: { write: () => undefined } }),
      deviceName: () => "Mac",
      activity: ALWAYS_VISIBLE,
      classifier: createFakeClassifier(),
      network: {
        oauthConfig: {
          ...oauthProviderConfig("google"),
          authorizeUrl: oauth.authorizeUrl,
          tokenUrl: oauth.tokenUrl,
          revokeUrl: oauth.revokeUrl,
        },
        oauthFetch: loopbackFetch,
        gmailFetch: gmail.fetch,
      },
    },
  );
  if (runtime === undefined) throw new Error("the runtime did not open");
  cleanups.push(() => runtime.close());

  const events: EventOf<"app.events">[] = [];
  runtime.handlers.subscriptions["app.events"]?.(undefined, (event) => events.push(event));

  // Guards: the key staying readable in the worker's memory after the database is open.
  expect(handedKey.every((byte) => byte === 0)).toBe(true);
  const outcome = await runtime.handlers.procedures["accounts.connect"]?.({ provider: "google" });
  expect(outcome?.status).toBe("connected");
  await runtime.idle();
  await vi.waitFor(() => expect(events.some((e) => e.type === "ScanCompleted")).toBe(true));
  expect(events.find((e) => e.type === "ScanCompleted")).toMatchObject({ processed: 3 });
  expect(await runtime.handlers.procedures["overview.get"]?.({})).toMatchObject({ scanned: 3 });

  // Only metadata was requested, and no row of the database holds mail text.
  expect(JSON.stringify(gmail.requests().map((r) => r.query.toString()))).not.toMatch(
    /Subject|snippet/i,
  );
  await runtime.close();
  cleanups.pop();
  const storage = openStorage(databasePath, key);
  if (!storage.ok) throw storage.error;
  cleanups.push(() => storage.value.close());
  const tables = storage.value.reader
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  let dump = "";
  for (const { name } of tables) {
    dump += JSON.stringify(storage.value.reader.prepare(`SELECT * FROM "${name}"`).all());
  }
  expect(dump.length).toBeGreaterThan(100);
  for (const marker of MARKERS) expect(dump).not.toContain(marker);
});
