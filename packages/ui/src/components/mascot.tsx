import defaultPose2x from "@pochimail/ui/assets/mascot/pochi-default@2x.png";
import defaultPose from "@pochimail/ui/assets/mascot/pochi-default.png";
import happyPose2x from "@pochimail/ui/assets/mascot/pochi-happy@2x.png";
import happyPose from "@pochimail/ui/assets/mascot/pochi-happy.png";
import nightPose2x from "@pochimail/ui/assets/mascot/pochi-night@2x.png";
import nightPose from "@pochimail/ui/assets/mascot/pochi-night.png";
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

/** Timings live in lib/motion.ts (Motion.dc.html is the source of truth). */
export const MASCOT_BREATHING_DURATION_MS = MOTION.mascotBreathingMs;
export const MASCOT_BLINK_DURATION_MS = MOTION.mascotBlinkMs;
export const MASCOT_FOUND_DURATION_MS = MOTION.mascotFoundMs;

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
    size: { sm: "w-16", md: "w-32", lg: "w-60" },
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
  const found = reaction === "found" && animationsEnabled;
  const idle = animationsEnabled;

  return (
    <span
      data-slot="mascot"
      data-pose={pose}
      data-animated={idle ? "true" : "false"}
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
      {/* The placeholder is a flat PNG: only breathing can play on it. Motion.dc.html's blink targets eye
          groups in the source artwork, so scaling the whole image would squash Pochi (and is omitted here). */}
      <span
        data-slot="mascot-breathe"
        className={cn("block", idle && "animate-pochi-breathe")}
        style={{ transformOrigin: "50% 92%" }}
      >
        <img
          data-slot="mascot-image"
          src={x1}
          srcSet={`${x1} 1x, ${x2} 2x`}
          alt={alt}
          className="block h-auto w-full"
        />
      </span>
    </span>
  );
}

export { Mascot, type MascotProps, MascotProvider, mascotVariants };
