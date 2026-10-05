import * as React from "react";
import { cn } from "@/lib/utils";
import { HelperText, Label } from "./typography";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      containerClassName,
      label,
      description,
      error,
      required,
      id,
      startAdornment,
      endAdornment,
      disabled,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const describedBy = error ? `${inputId}-error` : description ? `${inputId}-description` : undefined;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <Label htmlFor={inputId}>
            {label}
            {required && <span className="text-danger"> *</span>}
          </Label>
        )}
        <div className="relative flex items-center">
          {startAdornment && <span className="absolute left-3 text-muted-foreground">{startAdornment}</span>}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={describedBy}
            className={cn(
              "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-danger focus-visible:ring-danger",
              startAdornment && "pl-9",
              endAdornment && "pr-9",
              className,
            )}
            {...props}
          />
          {endAdornment && <span className="absolute right-3 text-muted-foreground">{endAdornment}</span>}
        </div>
        {error ? (
          <HelperText id={`${inputId}-error`} className="text-danger">
            {error}
          </HelperText>
        ) : description ? (
          <HelperText id={`${inputId}-description`}>{description}</HelperText>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";
