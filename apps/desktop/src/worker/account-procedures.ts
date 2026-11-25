import { InvalidCallback, MissingClientConfig, SignInCancelled } from "@pochimail/accounts/errors";
import type { Account } from "@pochimail/accounts/model/account";
import type { AccountsUnitOfWork } from "@pochimail/accounts/ports/unit-of-work";
import type { ConnectAccount } from "@pochimail/accounts/use-cases/connect-account";
import { ListAccounts } from "@pochimail/accounts/use-cases/list-accounts";
import type { RemoveAccount } from "@pochimail/accounts/use-cases/remove-account";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import {
  Cancelled,
  type InvalidStateError,
  NotFound,
  ProviderFailed,
  StorageError,
} from "@pochimail/kernel/errors";
import { AccountId, type WorkspaceId } from "@pochimail/kernel/ids";
import type { SignInError, SignInGrant } from "@pochimail/net/oauth/sign-in";
import type { EventOf, OutputOf } from "../shared/ipc/contract.ts";
import type { Handlers } from "../shared/ipc/server.ts";

export interface AccountProcedureDeps {
  readonly workspaceId: WorkspaceId;
  readonly uow: AccountsUnitOfWork;
  readonly connectAccount: ConnectAccount;
  /** Revokes at the provider, then deletes the keychain entry and the account's rows. */
  readonly removeAccount: RemoveAccount;
  /** Runs the Google sign-in in the system browser; tokens stay in this process. */
  readonly signIn: (signal: CancelSignal) => AsyncResult<SignInGrant, SignInError>;
  /** Starts the scan of a newly connected account. It may throw: that never fails the connect. */
  readonly startScan: (accountId: string) => Promise<void>;
  /** Revokes a refresh token at the provider, for a consent that is not kept. */
  readonly revoke: (refreshToken: string, signal: CancelSignal) => Promise<unknown>;
  /** Drops the account's cached access token, so the next call reads the keychain's new refresh token. */
  readonly forgetTokens: (accountId: string) => void;
  /** Stops the account's scans and resolves once they have ended. */
  readonly stopScans: (accountId: string) => Promise<void>;
  /** Drops the digest figures held in memory for the account. */
  readonly forgetDigest: (accountId: string) => void;
  /** Tells every `app.events` subscriber. */
  readonly emit: (event: EventOf<"app.events">) => void;
}

type ConnectOutcome = OutputOf<"accounts.connect">;
type SignInFailure = Exclude<ConnectOutcome, { status: "connected" }>;
type ReconnectOutcome = OutputOf<"accounts.reconnect">;
type RemoveOutcome = OutputOf<"accounts.remove">;

const PROVIDERS = { gmail: "google", graph: "microsoft" } as const;

/** A closed answer for the screen: nothing of the provider's reply, an address or a token goes into it. */
const failureOf = (error: SignInError): SignInFailure => {
  if (error instanceof SignInCancelled) return { status: "cancelled" };
  // The person pressed "Cancel" on the consent page: the provider redirects back with an error.
  if (error instanceof InvalidCallback && error.reason === "provider-error")
    return { status: "cancelled" };
  if (error instanceof MissingClientConfig) return { status: "failed", reason: "not-configured" };
  // The browser could not open or the token exchange failed: an actionable reason, never the provider's message.
  if (error instanceof ProviderFailed || error instanceof InvalidCallback)
    return { status: "failed", reason: "provider-failed" };
  return { status: "failed", reason: "unknown" };
};

/** A failed removal deleted nothing; the reason is a closed set, never the cause's message. */
const failureOfRemove = (error: StorageError | NotFound | Cancelled): RemoveOutcome => {
  if (error instanceof NotFound) return { status: "failed", reason: "not-found" };
  if (error instanceof StorageError) return { status: "failed", reason: "storage-unavailable" };
  return { status: "failed", reason: "unknown" };
};

/** A rejected account write is a storage problem, not a mystery sign-in error; the message never leaves the worker. */
const failureOfConnect = (
  error: StorageError | InvalidStateError | Cancelled,
  aborted: boolean,
): SignInFailure => {
  if (aborted || error instanceof Cancelled) return { status: "cancelled" };
  if (error instanceof StorageError) return { status: "failed", reason: "storage-unavailable" };
  return { status: "failed", reason: "unknown" };
};

type ReconnectFailure = Extract<ReconnectOutcome, { status: "failed" }>;
const reconnectFailure = (reason: ReconnectFailure["reason"]): ReconnectFailure => ({
  status: "failed",
  reason,
});

/** A new grant replaces the old token only when it is for this account's own mailbox. */
const refusal = (account: Account, grant: SignInGrant): ReconnectFailure | undefined => {
  if (grant.address === undefined) return reconnectFailure("no-address");
  const sameMailbox =
    grant.accountProvider === account.provider &&
    grant.address.trim().toLowerCase() === account.address;
  return sameMailbox ? undefined : reconnectFailure("wrong-account");
};

/**
 * The real answers for accounts: the list, the first-run flag, the sign-in, the reconnect and the removal. Everything else keeps the
 * worker's other handlers. The grant's tokens never leave this function: the refresh token goes to the
 * keychain through `ConnectAccount`, the access token is dropped, and only the account id is returned.
 */
export const createAccountProcedures = (
  deps: AccountProcedureDeps,
): Pick<
  Handlers["procedures"],
  | "accounts.connect"
  | "accounts.reconnect"
  | "accounts.remove"
  | "accounts.cancelConnect"
  | "accounts.list"
  | "app.state"
> => {
  const list = new ListAccounts({ uow: deps.uow });
  const accounts = async () => {
    const listed = await list.execute(deps.workspaceId);
    if (!listed.ok) throw listed.error;
    return listed.value;
  };
  // At most one sign-in waits at a time; Cancel aborts it, which closes the loopback listener.
  let waiting: AbortController | undefined;
  const whileWaiting = async <T>(run: (signal: CancelSignal) => Promise<T>): Promise<T> => {
    waiting?.abort();
    const controller = new AbortController();
    waiting = controller;
    try {
      return await run(controller.signal);
    } finally {
      if (waiting === controller) waiting = undefined;
    }
  };
  const accountToReconnect = async (accountId: string): Promise<Account | ReconnectFailure> => {
    const id = AccountId(accountId);
    if (!id.ok) return reconnectFailure("not-found");
    const found = await deps.uow.reads.accounts.get(deps.workspaceId, id.value);
    if (found.ok) return found.value;
    return reconnectFailure(found.error instanceof NotFound ? "not-found" : "storage-unavailable");
  };
  const startScan = async (accountId: string) => {
    try {
      await deps.startScan(accountId);
    } catch {
      // The account is connected; a scan that could not start is reported by its owner, not here.
    }
  };
  return {
    "app.state": async () => ({
      status: "ready",
      hasConnectedAccount: (await accounts()).length > 0,
    }),
    "accounts.list": async () =>
      (await accounts()).map((account) => ({
        id: account.id,
        provider: PROVIDERS[account.provider],
        displayName: account.address,
      })),
    "accounts.cancelConnect": () => {
      waiting?.abort();
    },
    "accounts.connect": (): Promise<ConnectOutcome> =>
      whileWaiting(async (signal) => {
        const grant = await deps.signIn(signal);
        if (!grant.ok) return failureOf(grant.error);
        if (grant.value.address === undefined) {
          // Consent without an address cannot become an account: do not leave the grant alive at the provider.
          await deps.revoke(grant.value.refreshToken, new AbortController().signal);
          return { status: "failed", reason: "no-address" };
        }
        const connected = await deps.connectAccount.execute(
          {
            workspaceId: deps.workspaceId,
            provider: grant.value.accountProvider,
            address: grant.value.address,
            credentials: grant.value.refreshToken,
            grantedScopes: grant.value.scopes,
          },
          signal,
        );
        if (!connected.ok) return failureOfConnect(connected.error, signal.aborted);
        await startScan(connected.value.account.id);
        return { status: "connected", accountId: connected.value.account.id };
      }),
    "accounts.remove": async ({ accountId }): Promise<RemoveOutcome> => {
      const id = AccountId(accountId);
      if (!id.ok) return { status: "failed", reason: "not-found" };
      // A scan still running would write rows of the account after they are deleted.
      await deps.stopScans(accountId);
      deps.forgetTokens(accountId);
      const removed = await deps.removeAccount.execute(
        { workspaceId: deps.workspaceId, accountId: id.value },
        new AbortController().signal,
      );
      if (!removed.ok) return failureOfRemove(removed.error);
      deps.forgetDigest(accountId);
      deps.emit({ type: "AccountRemoved", accountId });
      return { status: "removed", remoteRevoked: removed.value.remoteRevoked };
    },
    "accounts.reconnect": ({ accountId }): Promise<ReconnectOutcome> =>
      whileWaiting(async (signal) => {
        const account = await accountToReconnect(accountId);
        if ("status" in account) return account;
        const grant = await deps.signIn(signal);
        if (!grant.ok) return failureOf(grant.error);
        const { refreshToken, scopes, accountProvider } = grant.value;
        const refused = refusal(account, grant.value);
        if (refused !== undefined) {
          await deps.revoke(refreshToken, new AbortController().signal);
          return refused;
        }
        const stored = await deps.connectAccount.execute(
          {
            workspaceId: deps.workspaceId,
            provider: accountProvider,
            address: account.address,
            credentials: refreshToken,
            grantedScopes: scopes,
          },
          signal,
        );
        if (!stored.ok) return failureOfConnect(stored.error, signal.aborted);
        deps.forgetTokens(account.id);
        deps.emit({ type: "Reconnected", accountId: account.id });
        await startScan(account.id);
        return { status: "reconnected" };
      }),
  };
};
