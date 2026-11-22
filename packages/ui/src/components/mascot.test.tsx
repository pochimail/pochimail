import { MotionProvider } from "@pochimail/ui/components/motion-provider";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mascotBehaviorContract } from "../test-support/mascot-contract";
import { Mascot } from "./mascot";

function renderMarkup(element: React.ReactElement): string {
  const { container } = render(element);
  return container.innerHTML;
}

describe("Mascot behavior contract", () => {
  mascotBehaviorContract(renderMarkup);
});

describe("Mascot public behavior", () => {
  it("guards wrong pose assets by rendering the requested pose with 1x and 2x sources", () => {
    const html = renderMarkup(<Mascot pose="reading" />);
    expect(html).toContain('data-pose="reading"');
    expect(html).toMatch(
      /srcset="[^"]*pochi-reading\.png[^"]* 1x, [^"]*pochi-reading@2x\.png[^"]* 2x"/i,
    );
  });

  it("guards the idle breathing loop when animations are enabled", () => {
    const html = renderMarkup(
      <MotionProvider animations>
        <Mascot pose="default" />
      </MotionProvider>,
    );
    expect(html).toContain("animate-pochi-breathe");
    expect(html).not.toContain("animate-pochi-found");
  });

  it("blinks with eye lids instead of squashing the flat placeholder PNG", () => {
    const html = renderMarkup(
      <MotionProvider animations>
        <Mascot pose="default" />
      </MotionProvider>,
    );
    // The board's blink scales eye groups, never the whole flat image.
    expect(html).not.toContain("animate-pochi-blink");
    expect(html.match(/data-slot="mascot-lid"/g)).toHaveLength(2);
    expect(html).toContain('data-slot="mascot-image"');
  });

  it("guards missing found reaction by playing the squish-bounce when Pochi finds something", () => {
    const html = renderMarkup(<Mascot reaction="found" />);
    expect(html).toContain("animate-pochi-found");
    expect(html).toContain('data-reaction="found"');
  });

  it("guards found reaction animating when Animations are off", () => {
    const html = renderMarkup(
      <MotionProvider animations={false}>
        <Mascot reaction="found" />
      </MotionProvider>,
    );
    expect(html).not.toContain("animate-pochi-found");
    expect(html).not.toContain("animate-pochi-breathe");
    expect(html).not.toContain("animate-pochi-blink");
  });

  it("guards still mascot when the real prefers-reduced-motion media query is active", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const html = renderMarkup(<Mascot pose="default" />);
      expect(html).not.toMatch(/animate-pochi-(breathe|blink|found)/);
      expect(html).not.toContain('data-slot="mascot-lid"');
      expect(html).toContain('data-animated="false"');
    } finally {
      window.matchMedia = original;
    }
  });
});
