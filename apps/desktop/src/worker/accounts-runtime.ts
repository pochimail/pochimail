import type { Account } from "@pochimail/accounts/model/account";
import type { OAuthTokenSource } from "@pochimail/accounts/ports/oauth";
import { accountSecretKey, ConnectAccount } from "@pochimail/accounts/use-cases/connect-account";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { openStorage } from "@pochimail/db/open-storage";
import { createSqliteJobQueue } from "@pochimail/db/sqlite-job-queue";
import { createSqliteUnitOfWork } from "@pochimail/db/sqlite-unit-of-work";
import { createGmailProvider } from "@pochimail/gmail/provider";
import { WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import { egressPolicy } from "@pochimail/net/egress/allowlist";
import { createHttpClient, type Fetch } from "@pochimail/net/egress/http-client";
import { createRateLimitedClient, systemSleep } from "@pochimail/net/egress/rate-limit";
import { type FetchLike, platformFetch } from "@pochimail/net/oauth/http";
import {
  clientIdFrom,
  type OAuthProviderConfig,
  oauthProviderConfig,
} from "@pochimail/net/oauth/providers";
import { createOAuthRevoker } from "@pochimail/net/oauth/revoke";
import { OAuthSignIn } from "@pochimail/net/oauth/sign-in";
import { createAccessTokenSource } from "@pochimail/net/oauth/tokens";
import type { Timer } from "@pochimail/pipeline/event-batching";
import type { Handlers } from "../shared/ipc/server.ts";
import type { DeviceName } from "../shared/platform-port.ts";
import { DEFAULT_APP_SETTINGS } from "../shared/settings.ts";
import { createAccountProcedures } from "./account-procedures.ts";
import { createWorkerApp, type WorkerApp } from "./app.ts";
import { createMemorySettingsStore } from "./memory-settings.ts";
import type { WorkerStart } from "./start.ts";

/** The one local workspace of a device (Pochimail has no accounts of its own). */
const LOCAL_WORKSPACE = unwrap(WorkspaceId("wsp_00000000-0000-4000-8000-000000000001"));

export interface AccountsRuntimeOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timer: Timer;
  readonly logger: Logger;
  readonly deviceName: () => DeviceName;
  readonly classifier: Classifier;
  /** Tests point the providers at local fakes; the app leaves this out and uses the real hosts. */
  readonly network?: {
    readonly oauthConfig: OAuthProviderConfig;
    readonly oauthFetch: FetchLike;
    readonly gmailFetch: Fetch;
  };
}

/**
 * The real worker app: the encrypted database (key from main), the keychain-backed secret store, Google
 * sign-in and the Gmail provider over the egress policy, behind the same handlers the demo uses. Without
 * a key the database stays closed and the caller keeps its empty answers.
 */
export const createAccountsRuntime = (
  start: WorkerStart,
  options: AccountsRuntimeOptions,
): (WorkerApp & { readonly close: () => void }) | undefined => {
  if (start.databaseKey === undefined) return undefined;
  const storage = openStorage(start.databasePath, start.databaseKey);
  if (!storage.ok) return undefined;
  const clock = { now: () => new Date() };
  const { uow, outboxStore } = createSqliteUnitOfWork(storage.value, clock);
  const oauthConfig = options.network?.oauthConfig ?? oauthProviderConfig("google");
  const oauthFetch = options.network?.oauthFetch ?? platformFetch;

  const http = createRateLimitedClient({
    inner: createHttpClient({
      allowlist: egressPolicy.create(),
      ...(options.network === undefined ? {} : { fetch: options.network.gmailFetch }),
    }),
    clock,
    random: Math.random,
    sleep: systemSleep,
  });
  // One token source per account keeps its access token cached between scans.
  const tokenSources = new Map<string, OAuthTokenSource>();
  const tokensFor = (account: Account): OAuthTokenSource => {
    let source = tokenSources.get(account.id);
    if (source === undefined) {
      const clientId = clientIdFrom(oauthConfig, options.env);
      if (!clientId.ok) throw clientId.error;
      source = createAccessTokenSource({
        config: oauthConfig,
        clientId: clientId.value,
        env: options.env,
        secretKey: accountSecretKey(account),
        secrets: start.secrets,
        fetch: oauthFetch,
        grantedScopes: account.grantedScopes,
      });
      tokenSources.set(account.id, source);
    }
    return source;
  };

  const app = createWorkerApp({
    workspaceId: LOCAL_WORKSPACE,
    clock,
    random: Math.random,
    timer: options.timer,
    logger: options.logger,
    newJobId: () => crypto.randomUUID(),
    uow,
    outboxStore,
    queue: createSqliteJobQueue(storage.value, clock),
    settings: createMemorySettingsStore(),
    classifier: options.classifier,
    providerFor: (account) =>
      createGmailProvider({
        workspaceId: account.workspaceId,
        accountId: account.id,
        http,
        tokens: tokensFor(account),
      }),
    deviceName: options.deviceName,
  });

  const signIn = new OAuthSignIn({
    env: options.env,
    openBrowser: start.openBrowser,
    fetch: oauthFetch,
  });
  const revoker = createOAuthRevoker({
    fetch: oauthFetch,
    configs: { google: oauthConfig },
  });
  const accounts = createAccountProcedures({
    revoke: (token, signal) => revoker.revoke("gmail", token, signal),
    workspaceId: LOCAL_WORKSPACE,
    uow,
    connectAccount: new ConnectAccount({
      uow,
      secrets: start.secrets,
      clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID()}` },
    }),
    // The first consent follows the recommended autonomy; Setup's choice later re-prompts when it needs more (ADR 0007).
    signIn: (signal) =>
      signIn.execute(
        { provider: "google", autonomy: DEFAULT_APP_SETTINGS.autonomy, config: oauthConfig },
        signal,
      ),
    // The first scan of a new account starts right after connecting; a failure is the scan's own event, never the connect's.
    startScan: async (accountId) => {
      try {
        await app.handlers.procedures["scan.start"]?.({ accountId });
      } catch {
        options.logger.error("first scan could not start", {
          operation: "scan.start",
          code: "storage.failed",
        });
        throw new Error("first scan could not start");
      }
    },
  });
  const handlers: Handlers = {
    procedures: { ...app.handlers.procedures, ...accounts },
    subscriptions: app.handlers.subscriptions,
  };
  return { handlers, idle: app.idle, close: () => storage.value.close() };
};
