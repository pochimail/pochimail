import type { ReactNode } from "react";

/** One type step and leading for every page title (docs/design.md › Typography, `ttl` in Scan.html). */
export const PAGE_TITLE_CLASS = "text-balance text-title leading-heading";

/** One type step and weight for every section title (docs/design.md › Typography, 17px h2). */
export const SECTION_TITLE_CLASS = "text-section font-semibold";

/** One inset and vertical rhythm for every screen in the shell (Scan.html / Settings.html `.main`). */
export const PAGE_MAIN_CLASS = "flex w-full flex-col gap-8 px-8 pt-8 pb-16";

/**
 * The one h1 placement on a screen: the title first, with an optional translated note on its baseline
 * (an account count or a page description). No copy of its own.
 */
export function PageHeading({ title, note }: { title: ReactNode; note?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-4">
      <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
      {note === undefined ? null : <span className="text-ui text-muted-foreground">{note}</span>}
    </header>
  );
}
