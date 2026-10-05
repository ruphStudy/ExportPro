import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, id, ...props }, ref) => {
  const generatedId = React.useId();
  const checkboxId = id ?? generatedId;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        id={checkboxId}
        type="checkbox"
        className={cn(
          "size-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      />
      {label && (
        <label htmlFor={checkboxId} className="text-sm text-foreground">
          {label}
        </label>
      )}
    </div>
  );
});
Checkbox.displayName = "Checkbox";
