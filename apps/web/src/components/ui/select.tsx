import { ChevronDown } from "lucide-react";
import * as React from "react";
import type { SelectOption } from "@exportpro/types";
import { cn } from "@/lib/utils";
import { HelperText, Label } from "./typography";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  options: SelectOption[];
  containerClassName?: string;
}

/**
 * Native-element select: fully keyboard/screen-reader accessible for
 * free, and a stable foundation for the future country/product
 * selectors. A searchable combobox variant is intentionally deferred —
 * see ARCHITECTURE.md "Known Limitations".
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className, containerClassName, label, description, error, required, id, placeholder, options, disabled, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const describedBy = error ? `${selectId}-error` : description ? `${selectId}-description` : undefined;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <Label htmlFor={selectId}>
            {label}
            {required && <span className="text-danger"> *</span>}
          </Label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={describedBy}
            defaultValue={props.value !== undefined ? undefined : ""}
            className={cn(
              "h-9 w-full appearance-none rounded-md border border-border bg-surface px-3 pr-9 text-sm text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-danger focus-visible:ring-danger",
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled hidden>
                {placeholder}
              </option>
            )}
            {options.length === 0 && <option disabled>No options available</option>}
            {options.map((option) => (
              <option key={String(option.value)} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        {error ? (
          <HelperText id={`${selectId}-error`} className="text-danger">
            {error}
          </HelperText>
        ) : description ? (
          <HelperText id={`${selectId}-description`}>{description}</HelperText>
        ) : null}
      </div>
    );
  },
);
Select.displayName = "Select";
