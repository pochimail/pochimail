import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { openStorage } from "@pochimail/db/open-storage";
import { createLogger } from "@pochimail/logger/logger";
import type { Fetch } from "@pochimail/net/egress/http-client";
import { oauthProviderConfig } from "@pochimail/net/oauth/providers";
import { createFakeGmailServer, type FakeGmailServer } from "@pochimail/testing/fake-gmail-server";
import { type FakeOAuthServer, startFakeOAuthServer } from "@pochimail/testing/fake-oauth-server";
import { loopbackFetch } from "@pochimail/testing/loopback-fetch";
import { vi } from "vitest";
import { createRpcClient, type RpcClient } from "../shared/ipc/client.ts";
import type { EventOf } from "../shared/ipc/contract.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";
import { createAccountsRuntime } from "../worker/accounts-runtime.ts";

type AppEvent = EventOf<"app.events">;

export interface RuntimeHarness {
  readonly client: RpcClient;
  /** Every `app.events` event so far, in order. */
  readonly events: readonly AppEvent[];
  readonly oauth: FakeOAuthServer;
  /** The keychain: refresh tokens live here, under the worker's own keys. */
  readonly secrets: ReturnType<typeof createInMemorySecretStore>;
  /** The invented Gmail mailbox of one address, created on first use. Fill it before connecting that address. */
  mailbox(address: string): FakeGmailServer;
  /** Fills the mailbox of an address with `count` messages, oldest first. */
  fill(address: string, count: number): void;
  /** Connects an address through the real sign-in and answers its account id. */
  connect(address: string): Promise<string>;
  /** While set, Gmail answers 401 to the requests of this address for which `refuse` is true. */
  refuseGmail(address: string, refuse: ((url: string) => boolean) | undefined): void;
  /** While set, the provider's revocation endpoint cannot be reached. */
  setRevocationOffline(offline: boolean): void;
  /** How many rows of the account the database holds, including its account row and every table that has an `account_id`. */
  rowsOf(accountId: string): number;
  idle(): Promise<void>;
  close(): void;
}

/** Waits for something the worker does in the background; generous, because a busy CI machine is slow, never a pause. */
export const eventually = (assertion: () => void): Promise<void> =>
  vi.waitFor(assertion, { timeout: 10_000 });

const started: RuntimeHarness[] = [];
const servers: FakeOAuthServer[] = [];

/** Closes every harness a test started; call it from `afterEach`. */
export const closeHarnesses = async (): Promise<void> => {
  for (const harness of started.splice(0)) harness.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
};

const emailOf = (idToken: string): string | undefined => {
  const payload = idToken.split(".")[1];
  if (payload === undefined) return undefined;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    email?: string;
  };
  return claims.email;
};

const unauthorized = (): Awaited<ReturnType<Fetch>> => ({
  status: 401,
  ok: false,
  text: async () => JSON.stringify({ error: { code: 401 } }),
});

/**
 * The real worker (real database, real sign-in, token refresh and Gmail adapter) over the real RPC layer,
 * against a fake authorization server and one fake Gmail per address. Nothing here talks to a provider.
 */
export const startRuntimeHarness = async (): Promise<RuntimeHarness> => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-accounts-"));
  const databasePath = join(dir, "pochimail.db");
  const key = randomBytes(32);
  const oauth = await startFakeOAuthServer();
  servers.push(oauth);
  const secrets = createInMemorySecretStore();

  const mailboxes = new Map<string, FakeGmailServer>();
  const mailbox = (address: string): FakeGmailServer => {
    let server = mailboxes.get(address);
    if (server === undefined) {
      server = createFakeGmailServer();
      mailboxes.set(address, server);
    }
    return server;
  };
  // Which address an access token belongs to: learnt from the token endpoint's own answers.
  const addressOfRefresh = new Map<string, string>();
  const addressOfAccess = new Map<string, string>();
  const refusals = new Map<string, (url: string) => boolean>();
  let revocationOffline = false;

  const learn = (body: string, usedRefreshToken: string | null): void => {
    const tokens = JSON.parse(body) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
    };
    const address =
      tokens.id_token === undefined
        ? addressOfRefresh.get(usedRefreshToken ?? "")
        : emailOf(tokens.id_token);
    if (address === undefined) return;
    if (tokens.refresh_token !== undefined) addressOfRefresh.set(tokens.refresh_token, address);
    if (tokens.access_token !== undefined) addressOfAccess.set(tokens.access_token, address);
  };
  const oauthFetch: typeof loopbackFetch = async (url, init) => {
    if (revocationOffline && url === oauth.revokeUrl) throw new Error("offline");
    const response = await loopbackFetch(url, init);
    if (url === oauth.tokenUrl && response.ok)
      learn(response.body, new URLSearchParams(init.body ?? "").get("refresh_token"));
    return response;
  };
  const gmailFetch: Fetch = async (url, init) => {
    const bearer = (init.headers?.authorization ?? init.headers?.Authorization ?? "").replace(
      "Bearer ",
      "",
    );
    const address = addressOfAccess.get(bearer);
    if (address === undefined) return unauthorized();
    if (refusals.get(address)?.(url) === true) return unauthorized();
    return mailbox(address).fetch(url, init);
  };

  const runtime = createAccountsRuntime(
    {
      databasePath,
      databaseKey: Buffer.from(key),
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
          const handle = setTimeout(fn, ms);
          return () => clearTimeout(handle);
        },
      },
      logger: createLogger({ sink: { write: () => undefined } }),
      deviceName: () => "Mac",
      classifier: createFakeClassifier(),
      network: {
        oauthConfig: {
          ...oauthProviderConfig("google"),
          authorizeUrl: oauth.authorizeUrl,
          tokenUrl: oauth.tokenUrl,
          revokeUrl: oauth.revokeUrl,
        },
        oauthFetch,
        gmailFetch,
      },
    },
  );
  if (runtime === undefined) throw new Error("the runtime did not open");

  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), runtime.handlers);
  const client = createRpcClient(fromDomPort(port1));
  const events: AppEvent[] = [];
  client.subscribe("app.events", undefined, (event) => events.push(event));

  const harness: RuntimeHarness = {
    client,
    events,
    oauth,
    secrets,
    mailbox,
    fill: (address, count) => {
      for (let n = 1; n <= count; n += 1) {
        mailbox(address).add({
          id: `${address.split("@")[0]}-${n}`,
          threadId: `${address.split("@")[0]}-t${n}`,
          receivedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
          from: "sender@example.test",
          to: [address],
          subject: "",
          snippet: "",
          hasListUnsubscribe: false,
          opened: false,
        });
      }
    },
    connect: async (address) => {
      oauth.signInAs(address);
      const outcome = await client.call("accounts.connect", { provider: "google" });
      if (outcome.status !== "connected") throw new Error(`connect answered ${outcome.status}`);
      return outcome.accountId;
    },
    refuseGmail: (address, refuse) => {
      if (refuse === undefined) refusals.delete(address);
      else refusals.set(address, refuse);
    },
    setRevocationOffline: (offline) => {
      revocationOffline = offline;
    },
    rowsOf: (accountId) => {
      const storage = openStorage(databasePath, key);
      if (!storage.ok) throw storage.error;
      try {
        const tables = storage.value.reader
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[];
        const account = storage.value.reader
          .prepare("SELECT count(*) AS n FROM account WHERE id = ?")
          .get(accountId) as { n: number };
        let rows = account.n;
        for (const { name } of tables) {
          const columns = storage.value.reader.prepare(`PRAGMA table_info("${name}")`).all() as {
            name: string;
          }[];
          if (!columns.some((column) => column.name === "account_id")) continue;
          const counted = storage.value.reader
            .prepare(`SELECT count(*) AS n FROM "${name}" WHERE account_id = ?`)
            .get(accountId) as { n: number };
          rows += counted.n;
        }
        return rows;
      } finally {
        storage.value.close();
      }
    },
    idle: () => runtime.idle(),
    close: () => {
      runtime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  started.push(harness);
  return harness;
};
