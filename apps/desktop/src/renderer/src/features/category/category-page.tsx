import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey } from "@pochimail/ui/i18n/messages.ts";
import { useParams } from "@tanstack/react-router";

/** Notifications needs its own explanation; other categories keep the generic copy. */
const CATEGORY_COPY: Readonly<Record<string, MessageKey | undefined>> = {
  notifications: "category.notifications.placeholder",
};

export function CategoryPage() {
  const t = useT();
  const { categoryId } = useParams({ from: "/shell/category/$categoryId" });
  return (
    <main className="mx-auto max-w-2xl px-8 pt-16">
      <h1 className="text-4xl capitalize">{categoryId.replace(/-/g, " ")}</h1>
      <p className="mt-4 text-muted-foreground">
        {t(CATEGORY_COPY[categoryId] ?? "category.placeholder")}
      </p>
    </main>
  );
}
