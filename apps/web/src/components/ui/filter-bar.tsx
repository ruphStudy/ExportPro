"use client";

import { SlidersHorizontal, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Drawer } from "./drawer";
import { SearchInput } from "./search-input";

export interface FilterBarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  activeFilterCount?: number;
  onClearFilters?: () => void;
  /** Filter controls (Selects, etc.) — shown inline on desktop, inside a Drawer on mobile. */
  children?: React.ReactNode;
  className?: string;
}

export function FilterBar({ search, activeFilterCount = 0, onClearFilters, children, className }: FilterBarProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}>
      {search && (
        <div className="sm:max-w-xs sm:flex-1">
          <SearchInput
            value={search.value}
            placeholder={search.placeholder}
            onChange={(event) => search.onChange(event.target.value)}
            onClear={() => search.onChange("")}
          />
        </div>
      )}

      {children && (
        <div className="hidden items-center gap-2 sm:flex">
          {children}
          {activeFilterCount > 0 && onClearFilters && (
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              <X className="size-4" aria-hidden="true" />
              Clear ({activeFilterCount})
            </Button>
          )}
        </div>
      )}

      {children && (
        <Button variant="outline" size="sm" className="sm:hidden" onClick={() => setMobileFiltersOpen(true)}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      )}

      {children && (
        <Drawer open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen} title="Filters" side="right">
          <div className="flex flex-col gap-4">
            {children}
            {activeFilterCount > 0 && onClearFilters && (
              <Button variant="ghost" size="sm" onClick={onClearFilters}>
                <X className="size-4" aria-hidden="true" />
                Clear filters
              </Button>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
