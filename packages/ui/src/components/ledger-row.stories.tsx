import { LedgerRow } from "@pochimail/ui/components/ledger-row";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { darkDecorator, lightDecorator, narrowDecorator } from "./story-utils";

const meta = {
  title: "Components/LedgerRow",
  component: LedgerRow,
  decorators: [lightDecorator],
  args: { label: "Newsletters", count: 10410, size: "1.2 GB", share: 0.62, tone: "newsletter" },
  render: (args) => (
    <ul className="m-0 border-b border-border p-0">
      <LedgerRow {...args} className="border-t border-border" />
    </ul>
  ),
} satisfies Meta<typeof LedgerRow>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wide container (>= 760px): the bar shows.
export const WithBar: Story = {
  decorators: [
    (Story) => (
      <div className="w-215">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "padded" },
};
export const Compact: Story = { args: { share: undefined } };
export const Dark: Story = { decorators: [darkDecorator] };
export const LongFrench: Story = {
  decorators: [narrowDecorator],
  args: {
    label: "Messages de newsletters et de promotions que vous n’avez jamais ouverts",
    count: 10410,
    size: "1,2 Go",
    locale: "fr",
  },
};
export const LongJapanese: Story = {
  decorators: [narrowDecorator],
  args: {
    label: "一度も開いていないニュースレターとプロモーションのメール",
    count: 10410,
    size: "1.2 GB",
    locale: "ja",
  },
};
