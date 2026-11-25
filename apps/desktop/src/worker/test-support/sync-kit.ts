import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { createLogger } from "@pochimail/logger/logger";
import type { FetchInit } from "@pochimail/net/egress/http-client";
import { oauthProviderConfig } from "@pochimail/net/oauth/providers";
import { createFakeClock } from "@pochimail/testing/fake-clock";
import {
  createFakeGmailServer,
  type FakeGmailMessage,
  type FakeGmailServer,
} from "@pochimail/testing/fake-gmail-server";
import { startFakeOAuthServer } from "@pochimail/testing/fake-oauth-server";
import { createFakePowerMonitor } from "@pochimail/testing/fake-power-monitor";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { createFakeWindowActivity } from "@pochimail/testing/fake-window-activity";
import { loopbackFetch } from "@pochimail/testing/loopback-fetch";
import { expect, vi } from "vitest";
import { createRpcClient } from "../../shared/ipc/client.ts";
import type { EventOf } from "../../shared/ipc/contract.ts";
import { serveRpc } from "../../shared/ipc/server.ts";
import { fromDomPort } from "../../shared/ipc/transport.ts";
import { createAccountsRuntime } from "../accounts-runtime.ts";

/** A new message for the fake Gmail; the number only makes ids and dates unique. */
export const mail = (n: number, mailbox = "a"): FakeGmailMessage => ({
  id: `${mailbox}-m${n}`,
  threadId: `${mailbox}-t${n}`,
  receivedAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  from: "sender@example.test",
  to: ["person@example.test"],
  subject: `Subject ${n}`,
  snippet: `Snippet ${n}`,
  hasListUnsubscribe: false,
  opened: false,
});

/**
 * The real worker runtime over a real encrypted SQLite file and fake Gmail servers, one per account, with
 * time, power and window state under the test's control. `restart` is a quit and relaunch on the same file.
 */
export async function createSyncKit(accounts = 1) {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-poll-"));
  const databasePath = join(dir, "pochimail.db");
  const key = randomBytes(32);
  const oauth = await startFakeOAuthServer({ address: "unused@example.test" });
  const secrets = Object.assign(createInMemorySecretStore(), {
    protection: async () => ({ level: "os-keychain" as const, backend: "test" }),
  });
  const gmails: FakeGmailServer[] = Array.from({ length: accounts }, () => createFakeGmailServer());
  const clock = createFakeClock(new Date("2026-11-26T09:00:00.000Z"));
  const timer = createFakeTimer();
  const power = createFakePowerMonitor();
  const activity = createFakeWindowActivity("focused");
  const online = { value: true };
  let held: Promise<void> | null = null;

  // Each account's token is bound to the next unbound fake Gmail the first time it is used.
  const bound = new Map<string, FakeGmailServer>();
  let connecting = 0;
  const gmailFetch = async (url: string, init: FetchInit) => {
    if (!online.value) throw new TypeError("offline");
    if (held !== null) await held;
    const auth = init.headers?.authorization ?? init.headers?.Authorization ?? "";
    let server = bound.get(auth);
    if (server === undefined) {
      server = gmails[connecting] ?? gmails[0];
      if (server === undefined) throw new Error("no fake Gmail");
      bound.set(auth, server);
    }
    return server.fetch(url, init);
  };
  // The fake sign-in names one address; each connect asks for its own by rewriting the id token.
  let address = "person@example.test";
  const oauthFetch: typeof loopbackFetch = async (url, init) => {
    const reply = await loopbackFetch(url, init);
    if (!reply.ok || !reply.body.includes("id_token")) return reply;
    const parsed = JSON.parse(reply.body) as { id_token: string };
    parsed.id_token = `e30.${Buffer.from(JSON.stringify({ email: address })).toString("base64url")}.sig`;
    return { ...reply, body: JSON.stringify(parsed) };
  };

  const open = () => {
    const runtime = createAccountsRuntime(
      {
        databasePath,
        databaseKey: Buffer.from(key),
        secrets,
        openBrowser: async (url) => {
          const consent = await fetch(url, { redirect: "manual" });
          const location = consent.headers.get("location");
          if (location !== null) void fetch(location).catch(() => undefined);
        },
      },
      {
        env: { POCHIMAIL_GOOGLE_CLIENT_ID: "test-client" },
        timer,
        clock,
        power,
        activity,
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
    return runtime;
  };

  let runtime = open();
  const events: EventOf<"app.events">[] = [];
  const listen = () => {
    runtime.handlers.subscriptions["app.events"]?.(undefined, (event) => events.push(event));
  };
  listen();

  const call = async <K extends string>(name: K, input?: unknown) => {
    const procedure = (runtime.handlers.procedures as Record<string, (i: unknown) => unknown>)[
      name
    ];
    if (procedure === undefined) throw new Error(`no procedure ${name}`);
    return procedure(input);
  };

  return {
    gmails,
    events,
    power,
    activity,
    online,
    /** Connects the next account (its first scan starts at once) and waits for that scan to end. */
    async connect(next: string): Promise<string> {
      address = next;
      connecting = Math.min(bound.size, gmails.length - 1);
      const outcome = (await call("accounts.connect", { provider: "google" })) as {
        status: string;
        accountId: string;
      };
      if (outcome.status !== "connected") throw new Error(`connect ${outcome.status}`);
      await runtime.idle();
      await vi.waitFor(() =>
        expect(
          events.some((e) => e.type === "ScanCompleted" && e.accountId === outcome.accountId),
        ).toBe(true),
      );
      return outcome.accountId;
    },
    call,
    /** The real IPC layer over a MessageChannel, as the renderer talks to the worker. */
    rpc() {
      const { port1, port2 } = new MessageChannel();
      port1.start();
      port2.start();
      const dispose = serveRpc(fromDomPort(port2), runtime.handlers);
      const client = createRpcClient(fromDomPort(port1));
      return {
        client,
        close: () => {
          dispose();
          port1.close();
          port2.close();
        },
      };
    },
    /** Every Gmail request waits until the returned function is called: a sync that is slow to answer. */
    hold(): () => void {
      let release: () => void = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        held = null;
        release();
      };
    },
    /** Moves time forward in poll-sized steps; each poll that comes due finishes before the next. */
    async advance(ms: number, step = 60_000): Promise<void> {
      for (let left = ms; left > 0; left -= step) {
        const by = Math.min(step, left);
        clock.advance(by);
        timer.advance(by);
        await runtime.idle();
      }
    },
    /** A quit and a relaunch on the same database file. */
    async restart(): Promise<void> {
      await runtime.close();
      runtime = open();
      listen();
      await runtime.idle();
    },
    async quit(): Promise<void> {
      await runtime.close();
    },
    async cleanup(): Promise<void> {
      await runtime.close().catch(() => undefined);
      await oauth.close();
      rmSync(dir, { recursive: true, force: true });
    },
    scanned: async () => ((await call("overview.get", {})) as { scanned: number }).scanned,
  };
}
