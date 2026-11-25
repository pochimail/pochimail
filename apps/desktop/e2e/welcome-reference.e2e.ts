import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { appRoot, launchApp, WINDOW } from "./app.ts";
import { copy } from "./copy.ts";

const REFERENCE = join(appRoot, "..", "..", "docs", "design", "screens", "html", "Main.html");

/** What still counts as the same: sub-pixel text layout in pixels, and in unitless ratios (line height, tracking). */
const TOLERANCE = { px: 2, ratio: 0.01 } as const;

interface Measure {
  readonly offsetX: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly tracking: number;
  readonly fontWeight: string;
  readonly color: string;
}

type Part = "headline" | "description" | "button" | "footnote" | "mascot";
type Property = keyof Measure;

const SELECTORS: Record<Part, { app: string; reference: string }> = {
  headline: { app: "h1", reference: "h1" },
  description: { app: "main p", reference: "p" },
  button: { app: "main a", reference: "a" },
  footnote: { app: "main a ~ p", reference: "a + span" },
  mascot: { app: "[data-slot=mascot-image]", reference: "svg" },
};

/** Compared with the light desktop reference (the canonical one). Vertical position is left out: it follows the sizes. */
const COMPARED: Record<Part, readonly Property[]> = {
  headline: ["offsetX", "lineHeight", "tracking", "fontWeight", "color"],
  description: ["offsetX", "width", "height", "fontSize", "lineHeight", "color"],
  button: ["offsetX", "width", "height", "fontSize", "fontWeight", "color"],
  footnote: ["offsetX", "width", "height", "fontSize", "color"],
  mascot: ["offsetX"],
};

/**
 * Where the shipped Welcome differs from its reference today. Each entry pins the app's value, so the test fails the day a
 * difference is fixed (delete the entry then) or grows. The list may only shrink.
 */
const KNOWN_DIFFERENCES: readonly {
  part: Part;
  property: Property;
  app: number;
  reference: number;
}[] = [
  // `text-display @phone:text-title`: from a 560px container up the headline is the 32px title; the reference keeps the 40px display size.
  { part: "headline", property: "fontSize", app: 32, reference: 40 },
  // The mascot renders 180px wide; the reference draws it 240px wide.
  { part: "mascot", property: "width", app: 180, reference: 240 },
];

const measureAll = (page: Page, side: "app" | "reference"): Promise<Record<Part, Measure>> =>
  page.evaluate(
    ({ selectors, side }) => {
      // Distances are from the middle of the window: the reference's own window is `.win`, the app's is the viewport.
      const win = document.querySelector(".win")?.getBoundingClientRect();
      const reference = win === undefined ? 0 : win.x + win.width / 2;
      const middle = side === "reference" ? reference : innerWidth / 2;
      const result: Record<string, unknown> = {};
      for (const [part, pair] of Object.entries(selectors)) {
        const element = document.querySelector(pair[side]);
        if (element === null) throw new Error(`${side}: no ${part} (${pair[side]})`);
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize);
        result[part] = {
          offsetX: box.x + box.width / 2 - middle,
          width: box.width,
          height: box.height,
          fontSize,
          lineHeight: Number.parseFloat(style.lineHeight) / fontSize,
          tracking: Number.parseFloat(style.letterSpacing || "0") / fontSize,
          fontWeight: style.fontWeight,
          color: style.color,
        };
      }
      return result as Record<Part, Measure>;
    },
    { selectors: SELECTORS, side },
  );

const RATIOS: readonly Property[] = ["lineHeight", "tracking"];

const same = (property: Property, shipped: Measure, drawn: Measure): boolean => {
  const [a, r] = [shipped[property], drawn[property]];
  if (typeof a === "string" || typeof r === "string") return a === r;
  return Math.abs(a - r) <= (RATIOS.includes(property) ? TOLERANCE.ratio : TOLERANCE.px);
};

// Guards: the Welcome screen drifting from its light reference (docs/design/screens/html/Main.html) beyond the tolerance, or a known difference changing unnoticed.
test("the Welcome screen matches its light reference", async () => {
  const { app, page, problems, close } = await launchApp({ firstRun: true });
  try {
    await expect(
      page.getByRole("heading", { level: 1, name: copy("welcome.headline") }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const [reference] = await Promise.all([
      app.waitForEvent("window"),
      // A plain window, hardened like the app's, that only shows a static page of the design material.
      app.evaluate(
        ({ BrowserWindow }, { url, width, height }) =>
          new BrowserWindow({
            show: false,
            useContentSize: true,
            width,
            height,
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
          }).loadURL(url),
        {
          url: pathToFileURL(REFERENCE).href,
          width: WINDOW.width,
          height: WINDOW.height,
        },
      ),
    ]);
    await reference.waitForLoadState("load");
    await reference.evaluate(() => document.fonts.ready);

    const shipped = await measureAll(page, "app");
    const drawn = await measureAll(reference, "reference");
    const differing = Object.entries(COMPARED).flatMap(([part, properties]) =>
      properties
        .filter((property) => !same(property, shipped[part as Part], drawn[part as Part]))
        .map(
          (property) =>
            `${part} ${property}: ${shipped[part as Part][property]} (reference ${drawn[part as Part][property]})`,
        ),
    );
    expect(differing).toEqual([]);
    for (const { part, property, app: pinned, reference: drawnValue } of KNOWN_DIFFERENCES) {
      expect(shipped[part][property], `${part} ${property} in the app`).toBeCloseTo(pinned, 0);
      expect(drawn[part][property], `${part} ${property} in the reference`).toBeCloseTo(
        drawnValue,
        0,
      );
    }
    expect(problems).toEqual([]);
  } finally {
    await close();
  }
});
