import { InvalidCallback, MissingClientConfig, SignInCancelled } from "@pochimail/accounts/errors";
import type { AccountsUnitOfWork } from "@pochimail/accounts/ports/unit-of-work";
import type { ConnectAccount } from "@pochimail/accounts/use-cases/connect-account";
import { ListAccounts } from "@pochimail/accounts/use-cases/list-accounts";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import {
  Cancelled,
  type InvalidStateError,
  ProviderFailed,
  StorageError,
} from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import type { SignInError, SignInGrant } from "@pochimail/net/oauth/sign-in";
import type { OutputOf } from "../shared/ipc/contract.ts";
import type { Handlers } from "../shared/ipc/server.ts";

export interface AccountProcedureDeps {
  readonly workspaceId: WorkspaceId;
  readonly uow: AccountsUnitOfWork;
  readonly connectAccount: ConnectAccount;
  /** Runs the Google sign-in in the system browser; tokens stay in this process. */
  readonly signIn: (signal: CancelSignal) => AsyncResult<SignInGrant, SignInError>;
  /** Starts the scan of a newly connected account. It may throw: that never fails the connect. */
  readonly startScan: (accountId: string) => Promise<void>;
  /** Revokes a refresh token at the provider, for a consent that is not kept. */
  readonly revoke: (refreshToken: string, signal: CancelSignal) => Promise<unknown>;
}

type ConnectOutcome = OutputOf<"accounts.connect">;

const PROVIDERS = { gmail: "google", graph: "microsoft" } as const;

/** A closed answer for the screen: nothing of the provider's reply, an address or a token goes into it. */
const failureOf = (error: SignInError): ConnectOutcome => {
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

/** A rejected account write is a storage problem, not a mystery sign-in error; the message never leaves the worker. */
const failureOfConnect = (
  error: StorageError | InvalidStateError | Cancelled,
  aborted: boolean,
): ConnectOutcome => {
  if (aborted || error instanceof Cancelled) return { status: "cancelled" };
  if (error instanceof StorageError) return { status: "failed", reason: "storage-unavailable" };
  return { status: "failed", reason: "unknown" };
};

/**
 * The real answers for accounts: the list, the first-run flag and the sign-in. Everything else keeps the
 * worker's other handlers. The grant's tokens never leave this function: the refresh token goes to the
 * keychain through `ConnectAccount`, the access token is dropped, and only the account id is returned.
 */
export const createAccountProcedures = (
  deps: AccountProcedureDeps,
): Pick<
  Handlers["procedures"],
  "accounts.connect" | "accounts.cancelConnect" | "accounts.list" | "app.state"
> => {
  const list = new ListAccounts({ uow: deps.uow });
  const accounts = async () => {
    const listed = await list.execute(deps.workspaceId);
    if (!listed.ok) throw listed.error;
    return listed.value;
  };
  // At most one sign-in waits at a time; Cancel aborts it, which closes the loopback listener.
  let waiting: AbortController | undefined;
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
    "accounts.connect": async (): Promise<ConnectOutcome> => {
      waiting?.abort();
      const controller = new AbortController();
      waiting = controller;
      const { signal } = controller;
      try {
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
        try {
          await deps.startScan(connected.value.account.id);
        } catch {
          // The account is connected; a scan that could not start is reported by its owner, not here.
        }
        return { status: "connected", accountId: connected.value.account.id };
      } finally {
        if (waiting === controller) waiting = undefined;
      }
    },
  };
};
