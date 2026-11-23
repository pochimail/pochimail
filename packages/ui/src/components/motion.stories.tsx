import { Button } from "@pochimail/ui/components/button";
import { Checkbox } from "@pochimail/ui/components/checkbox";
import { CountUp } from "@pochimail/ui/components/count-up";
import { MotionProvider } from "@pochimail/ui/components/motion-provider";
import { RecommendationRow } from "@pochimail/ui/components/recommendation-row";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pochimail/ui/components/sheet";
import { SignalRow } from "@pochimail/ui/components/signal-row";
import { Toaster, undoToast } from "@pochimail/ui/components/sonner";
import { StatusStrip } from "@pochimail/ui/components/status-strip";
import { StorageBar } from "@pochimail/ui/components/storage-bar";
import { Switch } from "@pochimail/ui/components/switch";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

// Every moment of the motion catalog (docs/design.md › Motion catalog), replayable. "Animations off" shows the instant version.
// Pochi's own moments (breathing, found) live in Components/Mascot.
const meta = {
  title: "Motion/Catalog",
  parameters: { layout: "padded" },
  args: { animations: true },
  argTypes: { animations: { control: "boolean", name: "Animations setting" } },
  decorators: [
    (Story, { args }) => (
      <MotionProvider animations={args["animations"] as boolean}>
        <div className="w-105 max-w-full">
          <Story />
        </div>
      </MotionProvider>
    ),
  ],
} satisfies Meta<{ animations: boolean }>;

export default meta;
type Story = StoryObj<typeof meta>;

const findings = [
  "Labeled 214 emails as Job search",
  "Found 120 newsletters",
  "Archived 1,204 old promotions",
];

/** Progress line glides (600ms); each finding slides up 8px (220ms). */
export const LiveProgress: Story = {
  render: () => {
    const [run, setRun] = useState(0);
    const [step, setStep] = useState(0);
    // biome-ignore lint/correctness/useExhaustiveDependencies: `run` restarts the replay.
    useEffect(() => {
      setStep(0);
      const id = setInterval(() => setStep((s) => Math.min(s + 1, findings.length)), 1400);
      return () => clearInterval(id);
    }, [run]);
    return (
      <div className="flex flex-col gap-4">
        <StatusStrip
          progress={step * 33}
          headline="Sorting privately on this Mac"
          status={findings[Math.max(0, step - 1)] ?? ""}
        />
        <Button variant="secondary" size="sm" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
      </div>
    );
  },
};

/** Numbers roll up once from 0 (600ms, ease-out cubic), then stay still. */
export const NumbersArrive: Story = {
  render: () => {
    const [run, setRun] = useState(0);
    return (
      <div className="flex flex-col gap-2">
        <ul className="m-0 list-none p-0" key={run}>
          <SignalRow figure={<CountUp value={7} />} title="Sign-in alerts" reviewLabel="Review" />
          <SignalRow
            figure={<CountUp value={12940} format={(n) => n.toLocaleString("en")} />}
            title="Old promotions"
            reviewLabel="Review"
          />
        </ul>
        <Button variant="secondary" size="sm" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
      </div>
    );
  },
};

const settled = [
  { id: "keep", label: "Keep", value: 33, size: "3.3 GB", pattern: "solid" as const },
  { id: "clean", label: "Can clean", value: 31, size: "3.1 GB", pattern: "hatched" as const },
];

/** Bar fills once (700ms): keep segment, then the hatched one 140ms later; after a cleanup the hatched part shrinks. */
export const StorageSettles: Story = {
  render: () => {
    const [run, setRun] = useState(0);
    const [cleaned, setCleaned] = useState(false);
    const segments = cleaned
      ? settled.map((s) => (s.id === "clean" ? { ...s, value: 4 } : s))
      : settled;
    return (
      <div className="flex flex-col gap-4">
        <StorageBar key={run} segments={segments} summary="6.4 GB used" />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCleaned(false);
              setRun((r) => r + 1);
            }}
          >
            Replay
          </Button>
          <Button size="sm" onClick={() => setCleaned(true)}>
            Clean up
          </Button>
        </div>
      </div>
    );
  },
};

/** Row folds away (height 260ms + fade 200ms); the dark undo toast rises (220ms, 5s); Undo unfolds the row. */
export const CleanUpThenUndo: Story = {
  render: () => {
    const [folded, setFolded] = useState(false);
    return (
      <>
        <Toaster />
        <ul className="m-0 list-none p-0">
          <RecommendationRow
            folded={folded}
            sentence="Archive 1,204 old promotions"
            reason="You haven’t opened them in a year"
            size="1.2 GB"
            reviewLabel="Review"
          />
          <RecommendationRow
            sentence="Unsubscribe from 120 newsletters"
            size="640 MB"
            reviewLabel="Review"
          />
        </ul>
        <Button
          size="sm"
          disabled={folded}
          onClick={() => {
            setFolded(true);
            undoToast("1,204 emails archived", () => setFolded(false));
          }}
        >
          Archive 1,204
        </Button>
      </>
    );
  },
};

/** Standard summary sheet: scrim fades in and the sheet slides in (250ms, one easing). No stamp, overshoot or rotation. */
export const SummarySheet: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button>View summary</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Summary</SheetTitle>
          <SheetDescription>I sorted 18,402 emails.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
};

/** Check mark draws itself, ring cross-fades, switch thumb glides (150–220ms). */
export const ChoicesRespond: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Checkbox aria-label="Choice" />
      <Switch aria-label="Setting" />
    </div>
  ),
};

/** Content slides in 16px from the right (220ms); the step indicator stretches to the active step. */
export const ScreenToScreen: Story = {
  render: () => {
    const [step, setStep] = useState(0);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-[width,background-color] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"}`}
            />
          ))}
        </div>
        <div key={step} className="animate-screen-in font-display text-2xl">
          Step {step + 1}
        </div>
        <Button size="sm" onClick={() => setStep((s) => (s + 1) % 3)}>
          Next
        </Button>
      </div>
    );
  },
};
