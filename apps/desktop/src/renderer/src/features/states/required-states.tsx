import { Button } from "@pochimail/ui/components/button";
import { EmptyState } from "@pochimail/ui/components/empty-state";
import { StatusLine } from "@pochimail/ui/components/status-strip";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";

// The required states (brief §6): each composes the one EmptyState with its pose, copy and exactly
// one primary action. Only a state that needs the user to act now (reconnect) is an alert; the rest announce politely.
type Handler = { onAction: () => void };
type WithSecondary = Handler & { onSecondary: () => void };

function SignInCancelledState({ onAction, onSecondary }: WithSecondary) {
  const t = useT();
  return (
    <EmptyState
      role="status"
      pose="default"
      title={t("state.signInCancelled.title")}
      description={t("state.signInCancelled.body")}
      action={{ label: t("state.signInCancelled.retry"), onClick: onAction }}
      secondaryAction={{ label: t("state.signInCancelled.other"), onClick: onSecondary }}
    />
  );
}

/** Always mounted so assistive tech announces the change; empty (hidden) while online. */
function OfflineStatusLine({ offline, onAction }: Handler & { offline: boolean }) {
  const t = useT();
  return (
    <StatusLine>
      {offline ? (
        <>
          <span className="font-medium text-foreground">{t("state.offline.title")}</span>
          <span className="min-w-0 flex-1 break-words">{t("state.offline.body")}</span>
          <Button variant="ghost" onClick={onAction}>
            {t("state.offline.dismiss")}
          </Button>
        </>
      ) : null}
    </StatusLine>
  );
}

function NeedsReconnectState({
  provider,
  onAction,
  onSecondary,
}: WithSecondary & { provider: string }) {
  const t = useT();
  return (
    <EmptyState
      role="alert"
      pose="night"
      title={t("state.reconnect.title", { provider })}
      description={t("state.reconnect.body", { provider })}
      action={{ label: t("state.reconnect.action"), onClick: onAction }}
      secondaryAction={{ label: t("state.reconnect.remove"), onClick: onSecondary }}
    />
  );
}

function ModelDownloadFailedState({ onAction, onSecondary }: WithSecondary) {
  const t = useT();
  return (
    <EmptyState
      role="status"
      pose="night"
      title={t("state.modelFailed.title")}
      description={t("state.modelFailed.body")}
      action={{ label: t("state.modelFailed.retry"), onClick: onAction }}
      secondaryAction={{ label: t("state.modelFailed.rules"), onClick: onSecondary }}
    />
  );
}

function RateLimitState({
  provider,
  minutes,
  onAction,
}: Handler & { provider: string; minutes: number }) {
  const t = useT();
  return (
    <EmptyState
      role="status"
      pose="night"
      title={t("state.rateLimit.title", { provider })}
      description={t("state.rateLimit.body", { provider, minutes })}
      action={{ label: t("state.rateLimit.dismiss"), onClick: onAction }}
    />
  );
}

function EmptyCategoryState({ onAction }: Handler) {
  const t = useT();
  return (
    <EmptyState
      role="status"
      pose="happy"
      title={t("state.emptyCategory.title")}
      description={t("state.emptyCategory.body")}
      action={{ label: t("state.emptyCategory.action"), onClick: onAction }}
    />
  );
}

/** No mockup (decided 2026-11-18): copy and pose derived from the empty category state. */
function NothingToDoState({ onAction }: Handler) {
  const t = useT();
  return (
    <EmptyState
      role="status"
      pose="happy"
      title={t("state.nothingToDo.title")}
      description={t("state.nothingToDo.body")}
      action={{ label: t("state.nothingToDo.action"), onClick: onAction }}
    />
  );
}

export {
  EmptyCategoryState,
  ModelDownloadFailedState,
  NeedsReconnectState,
  NothingToDoState,
  OfflineStatusLine,
  RateLimitState,
  SignInCancelledState,
};
