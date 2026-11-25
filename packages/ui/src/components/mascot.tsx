import defaultPose2x from "@pochimail/ui/assets/mascot/pochi-default@2x.png";
import defaultPose from "@pochimail/ui/assets/mascot/pochi-default.png";
import happyPose2x from "@pochimail/ui/assets/mascot/pochi-happy@2x.png";
import happyPose from "@pochimail/ui/assets/mascot/pochi-happy.png";
import nightPose2x from "@pochimail/ui/assets/mascot/pochi-night@2x.png";
import nightPose from "@pochimail/ui/assets/mascot/pochi-night.png";
import nightRim from "@pochimail/ui/assets/mascot/pochi-night-rim@2x.png?inline";
import readingPose2x from "@pochimail/ui/assets/mascot/pochi-reading@2x.png";
import readingPose from "@pochimail/ui/assets/mascot/pochi-reading.png";
import savingPose2x from "@pochimail/ui/assets/mascot/pochi-saving@2x.png";
import savingPose from "@pochimail/ui/assets/mascot/pochi-saving.png";
import { useMotionEnabled } from "@pochimail/ui/hooks/use-motion";
import { MOTION } from "@pochimail/ui/lib/motion";
import { cn } from "@pochimail/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const poses = {
  default: [defaultPose, defaultPose2x],
  happy: [happyPose, happyPose2x],
  reading: [readingPose, readingPose2x],
  saving: [savingPose, savingPose2x],
  night: [nightPose, nightPose2x],
} as const;

export type MascotPose = keyof typeof poses;

/** Alpha masks scaled by CSS (so no 1x) for charcoal poses, painted behind the art with the `mascot-rim` token in dark mode. Inlined as data URIs: Chromium fetches CSS masks in CORS mode, which fails from file://. */
const rims: Partial<Record<MascotPose, string>> = { night: nightRim };

/** Only these poses have open eyes; smiles and sleeping faces must never blink. */
const OPEN_EYE_POSES: ReadonlySet<MascotPose> = new Set<MascotPose>(["default", "reading"]);

/** Timings live in lib/motion.ts (Motion.dc.html is the source of truth). */
export const MASCOT_BREATHING_DURATION_MS = MOTION.mascotBreathingMs;
export const MASCOT_BLINK_DURATION_MS = MOTION.mascotBlinkMs;
export const MASCOT_FOUND_DURATION_MS = MOTION.mascotFoundMs;

const idlePoses = ["glance", "nod", "tilt"] as const;
const [firstIdlePose] = idlePoses;
type MascotIdlePose = (typeof idlePoses)[number];
const idlePoseClasses: Record<MascotIdlePose, string> = {
  glance: "animate-pochi-glance",
  nod: "animate-pochi-nod",
  tilt: "animate-pochi-tilt",
};

/** One subtle flourish at a time, then a long randomized pause. No timers at all while disabled or hidden. */
function useMascotIdle(enabled: boolean): MascotIdlePose | null {
  const [pose, setPose] = React.useState<MascotIdlePose | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      setPose(null);
      return;
    }

    let next: ReturnType<typeof setTimeout> | undefined;
    let reset: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const gap =
        MOTION.mascotIdleMinGapMs +
        Math.random() * (MOTION.mascotIdleMaxGapMs - MOTION.mascotIdleMinGapMs);
      next = setTimeout(() => {
        setPose(idlePoses[Math.floor(Math.random() * idlePoses.length)] ?? firstIdlePose);
        reset = setTimeout(() => {
          setPose(null);
          schedule();
        }, MOTION.mascotIdleMs);
      }, gap);
    };

    schedule();
    return () => {
      if (next !== undefined) clearTimeout(next);
      if (reset !== undefined) clearTimeout(reset);
    };
  }, [enabled]);

  return pose;
}

const ShowPochiContext = React.createContext(true);

/** "Show Pochi" setting. The Animations setting comes from MotionProvider (one writer); Pochi reads it through useMotionEnabled. */
function MascotProvider({
  showPochi = true,
  children,
}: {
  showPochi?: boolean;
  children: React.ReactNode;
}) {
  return <ShowPochiContext value={showPochi}>{children}</ShowPochiContext>;
}

const mascotVariants = cva("block h-auto select-none", {
  variants: {
    size: { xs: "w-10", sm: "w-16", md: "w-32", lg: "w-45" },
  },
  defaultVariants: { size: "md" },
});

type MascotProps = Omit<React.ComponentProps<"span">, "children"> &
  VariantProps<typeof mascotVariants> & {
    pose?: MascotPose;
    /** Local override; hidden when this or the provider's `showPochi` is false. */
    show?: boolean;
    /** Local override for the Animations preference (context default). */
    animations?: boolean;
    /** One-shot "finds something" reaction (squish-bounce). */
    reaction?: "found";
    /** Decorative by default; set when Pochi carries meaning. */
    alt?: string;
  };

function Mascot({
  pose = "default",
  size,
  show = true,
  animations,
  reaction,
  alt = "",
  className,
  style,
  ...props
}: MascotProps) {
  const showPochi = React.use(ShowPochiContext);
  const animationsEnabled = useMotionEnabled(animations);
  const idle = useMascotIdle(animationsEnabled && show && showPochi);

  if (!show || !showPochi) {
    return (
      <span
        data-slot="mascot-placeholder"
        aria-hidden="true"
        className={cn(mascotVariants({ size }), "invisible aspect-[512/435]", className)}
        style={style}
        {...props}
      />
    );
  }

  const [x1, x2] = poses[pose];
  const rim = rims[pose];
  const found = reaction === "found" && animationsEnabled;
  const blinking = animationsEnabled && OPEN_EYE_POSES.has(pose);

  return (
    <span
      data-slot="mascot"
      data-pose={pose}
      data-animated={animationsEnabled ? "true" : "false"}
      data-reaction={found ? "found" : undefined}
      className={cn(
        mascotVariants({ size }),
        "relative inline-flex origin-bottom",
        found && "animate-pochi-found",
        className,
      )}
      style={{ transformOrigin: found ? "50% 95%" : "50% 92%", ...style }}
      {...props}
    >
      <span
        data-slot="mascot-idle"
        data-idle={idle ?? undefined}
        className={cn("relative block", idle && idlePoseClasses[idle])}
        style={{ transformOrigin: "50% 82%" }}
      >
        <span
          data-slot="mascot-breathe"
          className={cn("relative block", animationsEnabled && "animate-pochi-breathe")}
          style={{ transformOrigin: "50% 92%" }}
        >
          {rim ? (
            <span
              data-slot="mascot-rim"
              aria-hidden="true"
              className="absolute inset-0 dark:bg-mascot-rim"
              style={{ maskImage: `url(${rim})`, maskSize: "100% 100%" }}
            />
          ) : null}
          <img
            data-slot="mascot-image"
            src={x1}
            srcSet={`${x1} 1x, ${x2} 2x`}
            alt={alt}
            className="relative block h-auto w-full"
          />
        </span>
        {blinking ? (
          <span
            data-slot="mascot-lids"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            {["35%", "58%"].map((left) => (
              <span
                key={left}
                data-slot="mascot-lid"
                className="absolute rounded-full bg-[var(--mascot-lid)]"
                style={{ left, top: "55.9%", width: "7%", height: "11.8%" }}
              />
            ))}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export { Mascot, type MascotProps, MascotProvider, mascotVariants };
