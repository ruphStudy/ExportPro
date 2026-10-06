import * as React from "react";
import { cn } from "@/lib/utils";

export interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
}

export interface RadioCardGroupProps {
  name: string;
  options: RadioCardOption[];
  value?: string;
  onChange: (value: string) => void;
  columns?: 1 | 2 | 3;
  "aria-label"?: string;
}

/** Selectable cards behaving as a radio group — used where a plain <Select> would hide useful descriptive text (exporter type, risk tolerance). */
export function RadioCardGroup({ name, options, value, onChange, columns = 1, ...props }: RadioCardGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className={cn(
        "grid gap-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors",
              "focus-within:ring-2 focus-within:ring-ring",
              checked ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span className="font-medium text-foreground">{option.label}</span>
            {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
          </label>
        );
      })}
    </div>
  );
}
