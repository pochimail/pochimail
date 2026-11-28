import { EmptyState } from "@pochimail/ui/components/empty-state";
import type { T } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { OverviewView } from "./overview-figures.ts";

/** What replaces the figures: a failed read, no account to read, or an account whose mail has not arrived yet. */
export function NoFiguresState({
  view,
  t,
  onRetry,
  onConnect,
  onSync,
}: {
  view: OverviewView;
  t: T;
  onRetry: () => void;
  onConnect: () => void;
  onSync: () => void;
}) {
  const copy = {
    error: {
      title: t("overview.worker.unavailable"),
      label: t("overview.retry"),
      onClick: onRetry,
    },
    empty: {
      title: t("overview.empty.title"),
      description: t("overview.empty.description"),
      label: t("overview.empty.action"),
      onClick: onConnect,
    },
    syncing: {
      title: t("overview.syncing.title"),
      description: t("overview.syncing.description"),
      label: t("overview.retry"),
      onClick: onSync,
    },
  } as const;
  if (view !== "error" && view !== "empty" && view !== "syncing") return null;
  const { label, onClick, title, ...rest } = copy[view];
  return <EmptyState title={title} {...rest} action={{ label, onClick }} />;
}
