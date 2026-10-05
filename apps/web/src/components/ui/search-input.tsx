import { Loader2, Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  loading?: boolean;
  onClear?: () => void;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, loading, onClear, value, placeholder = "Search...", ...props }, ref) => {
    return (
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          value={value}
          placeholder={placeholder}
          className={cn(
            "h-9 w-full rounded-md border border-border bg-surface pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          {...props}
        />
        {loading ? (
          <Loader2 className="absolute right-3 size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : value && onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="absolute right-2.5 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
