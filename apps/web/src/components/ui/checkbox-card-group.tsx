import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxCardOption {
  value: string;
  label: string;
}

export interface CheckboxCardGroupProps {
  options: CheckboxCardOption[];
  value: string[];
  onChange: (value: string[]) => void;
  columns?: 2 | 3 | 4;
  "aria-label"?: string;
}

/** Multi-select rendered as toggle chips/cards rather than a dropdown — matches checkbox semantics (any count selectable) with better scannability than a long list. */
export function CheckboxCardGroup({ options, value, onChange, columns = 3, ...props }: CheckboxCardGroupProps) {
  const toggle = (optionValue: string) => {
    onChange(value.includes(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
  };

  return (
    <div
      role="group"
      aria-label={props["aria-label"]}
      className={cn(
        "grid gap-2",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {options.map((option) => {
        const checked = value.includes(option.value);
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
              "focus-within:ring-2 focus-within:ring-ring",
              checked ? "border-primary bg-primary/5 text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-muted",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(option.value)}
              className="size-4 rounded border-border text-primary focus-visible:outline-none"
            />
            <span className="truncate">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
