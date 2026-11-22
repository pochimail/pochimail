import { cn } from "@pochimail/ui/lib/utils";
import { CircleIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "relative after:absolute after:top-1/2 after:left-1/2 after:h-8 after:w-full after:min-w-8 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] aspect-square size-4 shrink-0 rounded-full border border-foreground-tertiary text-primary transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

/** A segment of the Settings.html Theme control: the whole item is the hit area, no radio circle. */
function SegmentedRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="segmented-radio-item"
      className={cn(
        "inline-flex h-7.5 cursor-pointer items-center justify-center rounded-md border-0 px-3 text-caption font-medium whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,box-shadow,transform] duration-(--duration-press) ease-(--ease-out) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-secondary active:scale-[0.98] data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-sm motion-reduce:transition-none motion-reduce:active:scale-100",
        className,
      )}
      {...props}
    >
      {children}
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem, SegmentedRadioItem };
