import { EmptyState } from "@pochimail/ui/components/empty-state";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useNavigate, useParams } from "@tanstack/react-router";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";
import { useSelectedAccounts } from "../../lib/use-selected-accounts.ts";
import { useTopics } from "../../lib/use-topics.ts";

export function TopicPage() {
  const t = useT();
  const navigate = useNavigate();
  const { topicId } = useParams({ from: "/shell/gate/topic/$topicId" });
  const { accountIds, loaded } = useSelectedAccounts();
  const topic = useTopics(accountIds, loaded).data?.find((item) => item.id === topicId);
  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={topic?.name ?? t("nav.topics")} />
      <EmptyState
        className="mt-4"
        role="status"
        pose="happy"
        title={t("state.emptyCategory.title")}
        description={t("state.emptyCategory.body")}
        action={{
          label: t("action.backToOverview"),
          onClick: () => void navigate({ to: "/overview" }),
        }}
      />
    </main>
  );
}
