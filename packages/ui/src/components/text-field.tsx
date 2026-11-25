import { cn } from "@pochimail/ui/lib/utils";
import { CircleAlertIcon } from "lucide-react";
import * as React from "react";

type TextFieldProps = Omit<React.ComponentProps<"input">, "id"> & {
  label: React.ReactNode;
  /** The reason the value is not accepted; shown under the field and announced. */
  error?: React.ReactNode;
  /** A line that is always shown under the field and tied to it with `aria-describedby`. */
  hint?: React.ReactNode;
};

/** A labelled single-line field (docs/design.md, Text field): the label sits above, the message below. */
function TextField({ className, label, error, hint, ...props }: TextFieldProps) {
  const id = React.useId();
  const messageId = `${id}-message`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? messageId : undefined, hint ? hintId : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <div data-slot="text-field" className="flex flex-col gap-2.5">
      <label htmlFor={id} className="text-caption font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "h-11 min-w-0 rounded-md border border-input bg-card px-3.5 text-body text-foreground outline-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-transparent aria-invalid:ring-2 aria-invalid:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      {error ? (
        <span
          id={messageId}
          role="alert"
          className="flex items-center gap-1.5 text-caption font-medium"
        >
          <CircleAlertIcon aria-hidden="true" className="size-4" />
          {error}
        </span>
      ) : null}
      {hint ? (
        <span
          id={hintId}
          className="flex items-center gap-2 text-caption text-muted-foreground [&_svg]:size-4 [&_svg]:flex-none"
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export { TextField, type TextFieldProps };
