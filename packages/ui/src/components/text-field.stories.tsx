import { TextField } from "@pochimail/ui/components/text-field";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { darkDecorator, lightDecorator, narrowDecorator } from "./story-utils";

const meta = {
  title: "Components/TextField",
  component: TextField,
  decorators: [lightDecorator],
  args: { label: "Passphrase", type: "password" },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { defaultValue: "correct horse" } };
export const WithError: Story = {
  args: { label: "Repeat the passphrase", error: "The two passphrases don’t match." },
};
export const WithHint: Story = { args: { hint: "I can’t recover a lost passphrase." } };
export const Disabled: Story = { args: { disabled: true } };
export const DarkWithError: Story = {
  decorators: [darkDecorator],
  args: { label: "Repeat the passphrase", error: "The two passphrases don’t match." },
};
export const LongFrench: Story = {
  decorators: [narrowDecorator],
  args: {
    label: "Répétez la phrase secrète",
    error: "Les deux phrases secrètes ne correspondent pas.",
  },
};
