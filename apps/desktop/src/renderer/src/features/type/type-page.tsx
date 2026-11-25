import { EmptyState } from "@pochimail/ui/components/empty-state";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";
import { typeLabelKey } from "../../lib/type-labels.ts";

/** Alert emails need their own explanation; other types use the shared empty state. */
const TYPE_COPY: Readonly<Record<string, MessageKey | undefined>> = {
  notification: "type.notification.placeholder",
};

export function TypePage() {
  const t = useT();
  const navigate = useNavigate();
  const { typeId } = useParams({ from: "/shell/type/$typeId" });
  const label = typeLabelKey(typeId);
  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={label === undefined ? typeId : t(label)} />
      <EmptyState
        className="mt-4"
        role="status"
        pose="happy"
        title={t("state.emptyCategory.title")}
        description={
          TYPE_COPY[typeId] === undefined
            ? t("state.emptyCategory.body")
            : t(TYPE_COPY[typeId] as "type.notification.placeholder")
        }
        action={{
          label: t("action.backToOverview"),
          onClick: () => void navigate({ to: "/overview" }),
        }}
      />
    </main>
  );
}
