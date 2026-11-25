import { MotionProvider } from "@pochimail/ui/components/motion-provider";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Mascot, MascotProvider } from "./mascot";
import { darkDecorator } from "./story-utils";

const meta = {
  title: "Components/Mascot",
  component: Mascot,
  args: { alt: "" },
} satisfies Meta<typeof Mascot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Happy: Story = { args: { pose: "happy" } };
export const Reading: Story = { args: { pose: "reading" } };
export const Saving: Story = { args: { pose: "saving" } };
export const Night: Story = { args: { pose: "night" } };

export const NightDark: Story = { args: { pose: "night" }, decorators: [darkDecorator] };

export const Small: Story = { args: { size: "sm" } };
export const Large: Story = { args: { size: "lg" } };

export const FoundReaction: Story = {
  args: { pose: "reading", reaction: "found" },
};

export const AnimationsOff: Story = {
  decorators: [
    (Story) => (
      <MotionProvider animations={false}>
        <Story />
      </MotionProvider>
    ),
  ],
};

export const ShowPochiOff: Story = {
  decorators: [
    (Story) => (
      <MascotProvider showPochi={false}>
        <div className="flex items-center gap-2 border border-dashed border-border p-2">
          <Story />
          <span className="text-ui text-muted-foreground">Layout space remains.</span>
        </div>
      </MascotProvider>
    ),
  ],
};

export const ReducedMotion: Story = {
  decorators: [
    (Story) => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
      try {
        return <Story />;
      } finally {
        window.matchMedia = original;
      }
    },
  ],
};
