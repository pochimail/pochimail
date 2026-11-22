import { SignalRow } from "@pochimail/ui/components/signal-row";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";

/** The figure track of a `grid-cols-[...]` utility, e.g. `minmax(3rem,auto)`. */
function figureTrack(className: string, utility: string): string | undefined {
  const prefix = `${utility}-[`;
  const value = className.split(/\s+/).find((token) => token.startsWith(prefix));
  return value?.slice(prefix.length, -1).split("_")[0];
}

// Guards: a wide figure (12,940 in "Numbers arrive") overflowing a fixed track and overlapping the title.
it("sizes the figure column to its content while keeping the minimum width", () => {
  render(
    <ul>
      <SignalRow figure="12,940" title="Old promotions" reviewLabel="Review" />
    </ul>,
  );
  const className = document.querySelector('[data-slot="signal-row"]')?.className ?? "";
  expect(figureTrack(className, "grid-cols")).toMatch(/^minmax\(3rem,(auto|max-content)\)$/);
  expect(figureTrack(className, "@narrow:grid-cols")).toMatch(
    /^minmax\(4\.5rem,(auto|max-content)\)$/,
  );
  expect(document.querySelector('[data-slot="signal-figure"]')?.textContent).toBe("12,940");
});
