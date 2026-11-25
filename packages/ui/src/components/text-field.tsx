import { cn } from "@pochimail/ui/lib/utils";
import { CircleAlertIcon } from "lucide-react";
import * as React from "react";

type TextFieldProps = Omit<React.ComponentProps<"input">, "id"> & {
  label: React.ReactNode;
  /** The reason the value is not accepted; shown under the field and announced. */
  error?: React.ReactNode;
};

/** A labelled single-line field (docs/design.md, Text field): the label sits above, the message below. */
function TextField({ className, label, error, ...props }: TextFieldProps) {
  const id = React.useId();
  const messageId = `${id}-message`;
  return (
    <div data-slot="text-field" className="flex flex-col gap-2.5">
      <label htmlFor={id} className="text-caption font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? messageId : undefined}
        className={cn(
          "h-11 min-w-0 rounded-md border border-input bg-background px-3.5 text-body text-foreground outline-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-transparent aria-invalid:ring-2 aria-invalid:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
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
    </div>
  );
}

export { TextField, type TextFieldProps };
