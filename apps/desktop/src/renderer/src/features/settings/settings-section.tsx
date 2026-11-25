import { cn } from "@pochimail/ui/lib/utils";
import type { ReactNode } from "react";
import { SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";

export const SETTINGS_ROW =
  "flex min-h-14 items-center gap-3.5 border-b border-border px-4.5 py-2.5 last:border-b-0";

/** One titled card of rows, as every Settings section in the reference. */
export function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className={cn("mx-1", SECTION_TITLE_CLASS)}>
        {title}
      </h2>
      <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">{children}</ul>
    </section>
  );
}
