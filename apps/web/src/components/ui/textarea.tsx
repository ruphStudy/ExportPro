import * as React from "react";
import { cn } from "@/lib/utils";
import { HelperText, Label } from "./typography";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  containerClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, containerClassName, label, description, error, required, id, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    const describedBy = error ? `${textareaId}-error` : description ? `${textareaId}-description` : undefined;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <Label htmlFor={textareaId}>
            {label}
            {required && <span className="text-danger"> *</span>}
          </Label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-h-24 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger focus-visible:ring-danger",
            className,
          )}
          {...props}
        />
        {error ? (
          <HelperText id={`${textareaId}-error`} className="text-danger">
            {error}
          </HelperText>
        ) : description ? (
          <HelperText id={`${textareaId}-description`}>{description}</HelperText>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
