"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import type { ReferenceOption } from "@exportpro/types";
import { cn } from "@/lib/utils";
import { Chip } from "./chip";
import { SearchInput } from "./search-input";
import { Label } from "./typography";

export interface MultiSelectSearchProps {
  label?: string;
  placeholder?: string;
  options: ReferenceOption[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/**
 * Searchable multi-select with removable chips — used for target
 * countries (and anywhere else a long structured list needs
 * type-to-filter). A documented gap in the Sprint 1 design system
 * (Select is native-only); this fills it rather than falling back to
 * free text, per ARCHITECTURE.md "Reference Data".
 */
export function MultiSelectSearch({ label, placeholder = "Search...", options, value, onChange, disabled }: MultiSelectSearchProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selectedOptions = options.filter((o) => value.includes(o.code));
  const filtered = options
    .filter((o) => !value.includes(o.code))
    .filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  const add = (code: string) => {
    onChange([...value, code]);
    setQuery("");
  };
  const remove = (code: string) => onChange(value.filter((v) => v !== code));

  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label>{label}</Label>}
      <PopoverPrimitive.Root open={open && !disabled} onOpenChange={setOpen}>
        <PopoverPrimitive.Anchor asChild>
          <div>
            <SearchInput
              value={query}
              disabled={disabled}
              placeholder={placeholder}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onClear={() => setQuery("")}
            />
          </div>
        </PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            align="start"
            sideOffset={4}
            className="z-50 max-h-60 w-[--radix-popover-trigger-width] overflow-y-auto rounded-md border border-border bg-surface shadow-md"
          >
            {filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No matches.</p>
            ) : (
              <ul role="listbox" className="p-1">
                {filtered.map((option) => (
                  <li key={option.code}>
                    <button
                      type="button"
                      onClick={() => add(option.code)}
                      className={cn(
                        "flex w-full items-center rounded-sm px-2.5 py-2 text-left text-sm text-foreground",
                        "hover:bg-muted focus-visible:outline-none focus-visible:bg-muted",
                      )}
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <Chip key={option.code} onRemove={disabled ? undefined : () => remove(option.code)}>
              {option.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
