import { Button } from "@pochimail/ui/components/button";
import type { MascotPose } from "@pochimail/ui/components/mascot";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import type { OutputOf } from "#shared/ipc/contract.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { PAGE_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { ConnectPromises } from "./connect-promises.tsx";
import gmailLogo from "./gmail.svg";

// The reference provider row: 52px tall, 26px logo well, 14px gaps, 12px control radius, hairline inset.
const providerButton =
  "h-13 w-full cursor-pointer justify-start gap-3.5 rounded-lg border-0 bg-card px-4 text-body text-foreground shadow-[inset_0_0_0_1px_var(--color-border)] transition-[color,background-color,box-shadow,transform] duration-(--duration-press) ease-(--ease-out) hover:bg-accent active:bg-secondary";

type Outcome = OutputOf<"accounts.connect">;

/** The one line that explains a sign-in that did not connect; `undefined` while there is nothing to explain. */
const problemKey = (outcome: Outcome | undefined, threw: boolean) => {
  if (threw) return "connect.failed";
  if (outcome?.status === "cancelled") return "connect.cancelled";
  if (outcome?.status !== "failed") return undefined;
  if (outcome.reason === "not-configured") return "connect.notConfigured";
  if (outcome.reason === "no-address") return "connect.noAddress";
  if (outcome.reason === "provider-failed") return "connect.providerFailed";
  if (outcome.reason === "storage-unavailable") return "connect.storageUnavailable";
  return "connect.failed";
};

type ProblemKey = NonNullable<ReturnType<typeof problemKey>>;

/** Connect's resting state: one provider, one action. */
const SignInState = ({ onStart }: { onStart: () => void }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-2.5">
      <Button variant="secondary" size="lg" className={providerButton} onClick={onStart}>
        <span aria-hidden="true" className="flex size-6.5 shrink-0 items-center justify-center">
          <img src={gmailLogo} alt="" width={20} height={20} className="block size-5" />
        </span>
        <span className="min-w-0 flex-1 text-left">{t("connect.gmail")}</span>
        <ChevronRightIcon className="size-4 shrink-0 text-foreground-tertiary" aria-hidden="true" />
      </Button>
    </div>
  );
};

/** The browser is open: Cancel is the only exit until the sign-in resolves. */
const WaitingState = ({ onCancel, disabled }: { onCancel: () => void; disabled: boolean }) => {
  const t = useT();
  return (
    <div className="flex min-h-13 flex-col items-start gap-3">
      <p role="status" aria-live="polite" className="text-body text-muted-foreground">
        {t("connect.waiting")}
      </p>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={onCancel}>
        {t("connect.cancel")}
      </Button>
    </div>
  );
};

/** A terminal outcome always explains itself and offers both a retry and a way back. */
const ProblemState = ({
  problem,
  onRetry,
  onBack,
}: {
  problem: ProblemKey;
  onRetry: () => void;
  onBack: () => void;
}) => {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-4">
      <p
        role={problem === "connect.cancelled" ? "status" : "alert"}
        aria-live="polite"
        className="text-body"
      >
        {t(problem)}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onRetry}>
          {t("connect.retry")}
        </Button>
        <Button variant="secondary" size="lg" onClick={onBack}>
          {t("connect.back")}
        </Button>
      </div>
    </div>
  );
};

/** Connect: sign in with Google in the system browser. Only the outcome crosses IPC, never a token. */
export function ConnectPage({ pose }: { pose: MascotPose }) {
  const t = useT();
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const deviceName = useQuery({
    queryKey: queryKeys.deviceName(),
    queryFn: () => client.call("device.name"),
  });
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.call("accounts.list"),
  });
  // Only an account being added to an existing setup needs a way out: first-run Connect keeps its reference layout.
  const addingAccount = (accounts.data?.length ?? 0) > 0;

  const connect = useMutation({
    mutationFn: async () => {
      // Adding an account to an existing setup skips Setup (the choices are already made).
      // Both calls leave at once: the port keeps order, so a Cancel pressed right away reaches the worker after the
      // connect has started (awaiting the list first let it arrive early, find nothing to cancel, and hang the sign-in).
      const listing = client.call("accounts.list");
      const connecting = client.call("accounts.connect", { provider: "google" });
      // The connect outcome is the truth: a failed list only means "treat it as a first account".
      const [existing, outcome] = await Promise.allSettled([listing, connecting]);
      if (outcome.status === "rejected") throw outcome.reason;
      return {
        outcome: outcome.value,
        firstAccount: existing.status === "rejected" || existing.value.length === 0,
      };
    },
    onSuccess: async ({ outcome, firstAccount }) => {
      if (outcome.status !== "connected") return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.appState() });
      await navigate({ to: firstAccount ? "/setup" : "/overview" });
    },
  });

  const cancel = useMutation({ mutationFn: () => client.call("accounts.cancelConnect") });
  const waiting = connect.isPending;
  const key = waiting
    ? undefined
    : problemKey(connect.isError ? undefined : connect.data?.outcome, connect.isError);
  const mascotPose =
    connect.isSuccess && connect.data?.outcome.status === "connected" ? "happy" : pose;
  // Retry starts from a clean mutation, so a stale error cannot linger behind the waiting state.
  const retry = () => {
    connect.reset();
    connect.mutate();
  };
  // A terminal state is not a trap: Back leaves it and restores the sign-in button.
  const back = () => {
    connect.reset();
    cancel.reset();
  };
  // The redirect out of the app frame has no sidebar to return through: go back in history, or to Settings if opened cold.
  const leave = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: "/settings" });
  };
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-16">
      <div className="flex flex-1 basis-85 flex-col gap-4 text-left">
        {addingAccount && !waiting && key === undefined ? (
          <Button variant="ghost" size="sm" onClick={leave}>
            <ArrowLeftIcon aria-hidden="true" />
            {t("connect.back")}
          </Button>
        ) : null}
        <h1 className={PAGE_TITLE_CLASS}>{t("connect.title")}</h1>
        <p className="text-body leading-relaxed text-muted-foreground">
          {t("connect.description")}
        </p>
        {waiting && (
          <WaitingState
            onCancel={() => cancel.mutate()}
            disabled={cancel.isPending || cancel.isSuccess}
          />
        )}
        {key !== undefined && <ProblemState problem={key} onRetry={retry} onBack={back} />}
        {!waiting && key === undefined && <SignInState onStart={retry} />}
      </div>
      <ConnectPromises device={deviceName.data ?? "device"} pose={mascotPose} />
    </div>
  );
}
