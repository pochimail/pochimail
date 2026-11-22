import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { cn } from "@pochimail/ui/lib/utils";
import { useParams } from "@tanstack/react-router";
import { categoryLabelKey } from "../../lib/category-labels.ts";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";

/** Notifications needs its own explanation; other categories keep the generic copy. */
const CATEGORY_COPY: Readonly<Record<string, MessageKey | undefined>> = {
  notifications: "category.notifications.placeholder",
};

export function CategoryPage() {
  const t = useT();
  const { categoryId } = useParams({ from: "/shell/category/$categoryId" });
  const label = categoryLabelKey(categoryId);
  return (
    <main className={cn(PAGE_MAIN_CLASS, "max-w-2xl")}>
      <PageHeading title={label === undefined ? categoryId : t(label)} />
      <p className="text-muted-foreground">
        {t(CATEGORY_COPY[categoryId] ?? "category.placeholder")}
      </p>
    </main>
  );
}
