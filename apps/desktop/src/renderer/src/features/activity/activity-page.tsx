import { EmptyState } from "@pochimail/ui/components/empty-state";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";

export function ActivityPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <main className={cn(PAGE_MAIN_CLASS, "max-w-2xl")}>
      <PageHeading title={t("activity.title")} />
      <EmptyState
        className="mt-4"
        role="status"
        pose="happy"
        title={t("state.emptyActivity.title")}
        description={t("state.emptyActivity.body")}
        action={{
          label: t("action.backToOverview"),
          onClick: () => void navigate({ to: "/overview" }),
        }}
      />
    </main>
  );
}
