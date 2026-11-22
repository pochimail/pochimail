import { EmptyState } from "@pochimail/ui/components/empty-state";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { categoryLabelKey } from "../../lib/category-labels.ts";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";

/** Notifications needs its own explanation; other categories use the shared empty state. */
const CATEGORY_COPY: Readonly<Record<string, MessageKey | undefined>> = {
  notifications: "category.notifications.placeholder",
};

export function CategoryPage() {
  const t = useT();
  const navigate = useNavigate();
  const { categoryId } = useParams({ from: "/shell/category/$categoryId" });
  const label = categoryLabelKey(categoryId);
  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={label === undefined ? categoryId : t(label)} />
      <EmptyState
        className="mt-4"
        role="status"
        pose="happy"
        title={t("state.emptyCategory.title")}
        description={
          CATEGORY_COPY[categoryId] === undefined
            ? t("state.emptyCategory.body")
            : t(CATEGORY_COPY[categoryId] as "category.notifications.placeholder")
        }
        action={{
          label: t("action.backToOverview"),
          onClick: () => void navigate({ to: "/overview" }),
        }}
      />
    </main>
  );
}
