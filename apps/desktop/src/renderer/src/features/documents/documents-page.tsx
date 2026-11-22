import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";

export function DocumentsPage() {
  const t = useT();
  return (
    <main className={cn(PAGE_MAIN_CLASS, "max-w-2xl")}>
      <PageHeading title={t("documents.title")} note={t("documents.description")} />
    </main>
  );
}
