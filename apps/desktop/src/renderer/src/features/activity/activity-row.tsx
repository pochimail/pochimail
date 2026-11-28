import { Button } from "@pochimail/ui/components/button";
import { type T, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { Lock } from "lucide-react";
import type { OutputOf } from "#shared/ipc/contract.ts";

export type ActivityEntry = OutputOf<"activity.list">["entries"][number];

const KEY = {
  archive: "activity.archived",
  trash: "activity.trash",
  unsubscribe: "activity.unsubscribe",
  unarchive: "activity.restored",
  untrash: "activity.restored",
  other: "activity.other",
} as const;

const titleOf = (entry: ActivityEntry, t: T): string => {
  const params = { count: entry.messageCount };
  if (entry.outcome === "failed") return t("activity.failed.title", params);
  if (entry.outcome === "refused") return t("activity.refused.title", params);
  return t(`${KEY[entry.kind]}.title`, params);
};

const detailOf = (entry: ActivityEntry, t: T): string => {
  if (entry.outcome === "failed") return t("activity.failed.detail");
  if (entry.outcome === "refused") return t("activity.refused.detail");
  if (entry.outcome === "undone") return t("activity.undone.detail");
  return entry.kind === "archive" || entry.kind === "trash" || entry.kind === "unsubscribe"
    ? t(`${KEY[entry.kind]}.detail`)
    : t("activity.restored.detail");
};

/** What stands at the end of a row: the Undo button, or why there is none (the design's three quiet states). */
function Trailing({
  entry,
  busy,
  onUndo,
}: {
  readonly entry: ActivityEntry;
  readonly busy: boolean;
  readonly onUndo: () => void;
}) {
  const t = useT();
  if (entry.undo === "available")
    return (
      <Button variant="secondary" size="sm" disabled={busy} onClick={onUndo}>
        {t("action.undo")}
      </Button>
    );
  if (entry.undo === "irreversible")
    return (
      <span className="flex items-center gap-1.5 text-ui font-semibold">
        <Lock aria-hidden="true" className="size-3.5" />
        {t("activity.cantUndo")}
      </span>
    );
  if (entry.outcome === "undone")
    return <span className="text-ui font-semibold">{t("activity.undone")}</span>;
  if (entry.outcome === "applied")
    return <span className="text-ui text-muted-foreground">{t("activity.undoUnavailable")}</span>;
  return null;
}

/** One action as one row: what happened, the time and the way back (#138). Counts only, never mail content. */
export function ActivityRow({
  entry,
  time,
  busy,
  onUndo,
}: {
  readonly entry: ActivityEntry;
  readonly time: string;
  readonly busy: boolean;
  readonly onUndo: () => void;
}) {
  const t = useT();
  return (
    <li className="flex items-center gap-4 border-b py-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-body font-semibold">{titleOf(entry, t)}</p>
        <p className="m-0 text-ui text-muted-foreground">{detailOf(entry, t)}</p>
      </div>
      <time dateTime={entry.at} className="text-ui tabular-nums text-muted-foreground">
        {time}
      </time>
      <div className="flex min-w-28 justify-end">
        <Trailing entry={entry} busy={busy} onUndo={onUndo} />
      </div>
    </li>
  );
}
