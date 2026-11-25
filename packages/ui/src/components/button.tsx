import { cn } from "@pochimail/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-ui font-medium whitespace-nowrap outline-none transition-[color,background-color,border-color,transform] duration-(--duration-press) ease-(--ease-out) active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border bg-transparent text-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        destructive: "bg-destructive text-background hover:bg-destructive/90",
        link: "text-foreground underline underline-offset-4 hover:text-muted-foreground",
      },
      size: {
        default: "min-h-8 px-4 py-2 has-[>svg]:px-3",
        sm: "min-h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "min-h-11 rounded-lg px-6 text-base has-[>svg]:px-4",
        icon: "size-8",
        "icon-lg": "size-11 rounded-lg",
      },
    },
    compoundVariants: [
      // Brief §6: primary buttons are 44px tall; secondary and ghost keep the 32px minimum.
      { variant: "primary", size: "default", class: "min-h-11" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, type ButtonProps, buttonVariants };
