import { Button } from "@pochimail/ui/components/button";
import { cn } from "@pochimail/ui/lib/utils";
import type * as React from "react";

type SignalRowProps = Omit<React.ComponentProps<"li">, "children"> & {
  /** The large figure, e.g. 7 or <CountUp value={7} />. */
  figure: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  onReview?: () => void;
  reviewLabel: string;
};

function SignalRow({
  className,
  figure,
  title,
  detail,
  onReview,
  reviewLabel,
  ...props
}: SignalRowProps) {
  return (
    <li
      data-slot="signal-row"
      className={cn(
        "@container grid list-none grid-cols-[minmax(3rem,auto)_minmax(0,1fr)_auto] items-center gap-x-4 py-3.5 @narrow:grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto]",
        className,
      )}
      {...props}
    >
      <span
        data-slot="signal-figure"
        className="font-display text-title-sm leading-none font-title tracking-title tabular-nums @narrow:text-title"
      >
        {figure}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words text-body font-medium">{title}</span>
        {detail ? (
          <span className="break-words text-caption text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      <Button variant="link" size="sm" data-slot="signal-review" onClick={onReview}>
        {reviewLabel}
      </Button>
    </li>
  );
}

export { SignalRow, type SignalRowProps };
