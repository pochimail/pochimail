import type { EventOf } from "#shared/ipc/contract.ts";

/** Worker events (parsed by the IPC contract) plus the two sign-in events the renderer raises itself. */
export type RequiredStateEvent =
  | EventOf<"app.events">
  | { type: "SignInCancelled" }
  | { type: "SignInStarted" };

export type RequiredStates = {
  readonly offline: boolean;
  readonly rateLimit: { readonly provider: string; readonly resumeAt: number } | null;
  readonly needsReauth: readonly { readonly accountId: string; readonly provider: string }[];
  readonly signInCancelled: boolean;
  readonly modelDownloadFailed: boolean;
};

export const noRequiredStates: RequiredStates = {
  offline: false,
  rateLimit: null,
  needsReauth: [],
  signInCancelled: false,
  modelDownloadFailed: false,
};

export function reduceRequiredStates(
  state: RequiredStates,
  event: RequiredStateEvent,
): RequiredStates {
  switch (event.type) {
    case "Offline":
      return { ...state, offline: true };
    case "Online":
      return { ...state, offline: false };
    case "RateLimited":
      return { ...state, rateLimit: { provider: event.provider, resumeAt: event.resumeAt } };
    // Sync flowing again proves we are online and the limit is over: both notices clear themselves.
    case "SyncResumed":
      return { ...state, offline: false, rateLimit: null };
    case "NeedsReauth":
      return {
        ...state,
        needsReauth: [
          ...state.needsReauth.filter((account) => account.accountId !== event.accountId),
          { accountId: event.accountId, provider: event.provider },
        ],
      };
    case "Reconnected":
      return {
        ...state,
        needsReauth: state.needsReauth.filter((account) => account.accountId !== event.accountId),
      };
    case "SignInCancelled":
      return { ...state, signInCancelled: true };
    case "SignInStarted":
      return { ...state, signInCancelled: false };
    case "ModelDownloadFailed":
      return { ...state, modelDownloadFailed: true };
    case "ModelDownloadStarted":
      return { ...state, modelDownloadFailed: false };
    case "ActionApplied":
    case "ActionFailed":
    case "ScanCompleted":
    case "ScanFailed":
    case "ScanCancelled":
    case "DigestReady":
      return state;
    default: {
      // A newer worker may emit an event this build does not know: ignore it, never crash.
      const unreachable: never = event;
      void unreachable;
      return state;
    }
  }
}

/** Whole minutes to show for an auto-resume estimate; never below 1 so it never reads "0 minutes". */
export function minutesUntil(resumeAt: number, now: number): number {
  return Math.max(1, Math.ceil((resumeAt - now) / 60_000));
}
