import { MotionProvider } from "@pochimail/ui/components/motion-provider";
import { MOTION } from "@pochimail/ui/lib/motion";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mascotBehaviorContract } from "../test-support/mascot-contract";
import { Mascot, MascotProvider } from "./mascot";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

  // Guards: closed-eye poses blinking over an already-closed smile or sleeping face.
  it("renders blink lids only for open-eye poses when animations are enabled", () => {
    for (const pose of ["happy", "saving", "night"] as const) {
      const html = renderMarkup(
        <MotionProvider animations>
          <Mascot pose={pose} />
        </MotionProvider>,
      );
      expect(html).not.toContain('data-slot="mascot-lids"');
      expect(html).not.toContain('data-slot="mascot-lid"');
    }
    for (const pose of ["default", "reading"] as const) {
      const html = renderMarkup(
        <MotionProvider animations>
          <Mascot pose={pose} />
        </MotionProvider>,
      );
      expect(html.match(/data-slot="mascot-lid"/g)).toHaveLength(2);
    }
  });

  it("guards missing found reaction by playing the squish-bounce when Pochi finds something", () => {
    const html = renderMarkup(<Mascot reaction="found" />);
    expect(html).toContain("animate-pochi-found");
    expect(html).toContain('data-reaction="found"');
  });

  // Guards: the charcoal night pose vanishing on dark surfaces (dark ink on a dark background).
  it("draws the night pose over a token-colored rim that breathes with it, and no other pose", () => {
    const night = renderMarkup(<Mascot pose="night" />);
    const rim = night.indexOf('data-slot="mascot-rim"');
    expect(rim).toBeGreaterThan(night.indexOf('data-slot="mascot-breathe"'));
    expect(rim).toBeLessThan(night.indexOf('data-slot="mascot-image"'));
    expect(night).toContain("dark:bg-mascot-rim");
    // Guards: a file URL mask, which Chromium refuses to fetch from file:// (the packaged app), so the rim would never render.
    expect(night).toMatch(/mask-image: url\((?:&quot;|"|')?data:image\/png;base64,/);
    for (const pose of ["default", "happy", "reading", "saving"] as const) {
      expect(renderMarkup(<Mascot pose={pose} />)).not.toContain('data-slot="mascot-rim"');
    }
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
      expect(html).not.toMatch(/data-idle=|animate-pochi-(glance|nod|tilt)/);
    } finally {
      window.matchMedia = original;
    }
  });

  it("guards closed-eye poses from blinking while open-eye poses keep blinking", () => {
    for (const pose of ["happy", "saving", "night"] as const) {
      const html = renderMarkup(
        <MotionProvider animations>
          <Mascot pose={pose} />
        </MotionProvider>,
      );
      expect(html, pose).not.toContain('data-slot="mascot-lid"');
    }
    for (const pose of ["default", "reading"] as const) {
      const html = renderMarkup(
        <MotionProvider animations>
          <Mascot pose={pose} />
        </MotionProvider>,
      );
      expect(html, pose).toContain('data-slot="mascot-lid"');
    }
  });
});

describe("Mascot idle flourishes", () => {
  it("guards the one-shot cadence: a flourish waits for the gap, then clears", () => {
    // Guards: an idle flourish firing immediately, looping, or leaving its class on Pochi.
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = render(
      <MotionProvider animations>
        <Mascot />
      </MotionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(MOTION.mascotIdleMinGapMs - 1);
    });
    expect(container.innerHTML).not.toContain("data-idle=");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.innerHTML).toContain('data-idle="glance"');
    expect(container.innerHTML).toContain("animate-pochi-glance");
    act(() => {
      vi.advanceTimersByTime(MOTION.mascotIdleMs);
    });
    expect(container.innerHTML).not.toContain("data-idle=");
    expect(container.innerHTML).not.toContain("animate-pochi-glance");
  });

  it.each([
    [0.5, "nod"],
    [0.99, "tilt"],
  ])("guards the %s pose selecting its own class", (poseRandom, pose) => {
    // Guards: the random picker applying the wrong keyframe class or data attribute.
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(poseRandom);
    const { container } = render(
      <MotionProvider animations>
        <Mascot />
      </MotionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(MOTION.mascotIdleMinGapMs);
    });
    expect(container.innerHTML).toContain(`data-idle="${pose}"`);
    expect(container.innerHTML).toContain(`animate-pochi-${pose}`);
  });

  it("guards no idle timers when Animations are off or Pochi is hidden", () => {
    // Guards: a hidden or motionless Pochi still animating in the background.
    vi.useFakeTimers();
    const off = render(
      <MotionProvider animations={false}>
        <Mascot />
      </MotionProvider>,
    );
    const hiddenLocal = render(
      <MotionProvider animations>
        <Mascot show={false} />
      </MotionProvider>,
    );
    const hiddenSetting = render(
      <MotionProvider animations>
        <MascotProvider showPochi={false}>
          <Mascot />
        </MascotProvider>
      </MotionProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(MOTION.mascotIdleMaxGapMs * 10);
    });
    for (const html of [off, hiddenLocal, hiddenSetting].map((r) => r.container.innerHTML)) {
      expect(html).not.toContain("data-idle=");
      expect(html).not.toMatch(/animate-pochi-(glance|nod|tilt)/);
    }
  });
});
