import { EmptyState } from "@pochimail/ui/components/empty-state";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useNavigate } from "@tanstack/react-router";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";

export function DocumentsPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={t("documents.title")} />
      <EmptyState
        className="mt-4"
        role="status"
        pose="reading"
        title={t("state.emptyDocuments.title")}
        description={t("state.emptyDocuments.body")}
        action={{
          label: t("action.backToOverview"),
          onClick: () => void navigate({ to: "/overview" }),
        }}
      />
    </main>
  );
}
