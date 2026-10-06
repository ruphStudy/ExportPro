"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import * as React from "react";
import type { CodeSystem, HSReferenceItem } from "@exportpro/types";
import { tariffReferenceApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { HelperText, Label } from "@/components/ui/typography";
import { CodeLabel } from "./classification-bits";

const SYSTEM_OPTIONS = [
  { value: "", label: "All code systems" },
  { value: "HS", label: "HS (2/4/6-digit)" },
  { value: "ITC_HS_INDIA", label: "ITC-HS India (8-digit)" },
];

export const itemKey = (item: Pick<HSReferenceItem, "code" | "codeSystem">) => `${item.codeSystem}:${item.code}`;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Manual code search over the tariff reference (database query — never
 * the AI provider). Results are a radio group, so arrow keys move between
 * codes and the choice is announced.
 */
export function HsCodeSearch({
  selected,
  onSelect,
  initialQuery = "",
}: {
  selected: HSReferenceItem | null;
  onSelect: (item: HSReferenceItem) => void;
  initialQuery?: string;
}) {
  const inputId = React.useId();
  const [q, setQ] = React.useState(initialQuery);
  const [system, setSystem] = React.useState<CodeSystem | "">("");
  const term = useDebounced(q.trim(), 300);
  // Page resets to 1 whenever the search term or code system changes.
  const searchKey = `${term}|${system}`;
  const [pageState, setPageState] = React.useState({ key: searchKey, page: 1 });
  const page = pageState.key === searchKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ key: searchKey, page: next });

  const search = useQuery({
    queryKey: ["product-classifications", "search", term, system, page],
    queryFn: ({ signal }) => tariffReferenceApi.search(term, system || undefined, page, signal),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
  });
  const items = search.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Search by code or description</Label>
          <SearchInput
            id={inputId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClear={() => setQ("")}
            loading={search.isFetching}
            placeholder="e.g. 0909, 610910, cumin, t-shirts"
            autoComplete="off"
          />
        </div>
        <Select
          label="Code system"
          value={system}
          onChange={(e) => setSystem(e.target.value as CodeSystem | "")}
          options={SYSTEM_OPTIONS}
        />
      </div>

      <div aria-live="polite" className="sr-only">
        {search.isFetching ? "Searching" : search.data ? `${search.data.meta.totalItems} codes found` : ""}
      </div>

      {term.length < 2 ? (
        <HelperText>Enter at least 2 characters.</HelperText>
      ) : search.isError ? (
        <ErrorState title="Search failed" message={toFriendlyErrorMessage(search.error)} onRetry={() => search.refetch()} className="p-6" />
      ) : search.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={SearchX} title="No matching codes" description="Try a different code or a broader term." className="p-6" />
      ) : (
        <>
          <div role="radiogroup" aria-label="Matching codes" className="flex flex-col gap-2">
            {items.map((item) => {
              const checked = selected ? itemKey(selected) === itemKey(item) : false;
              return (
                <label
                  key={itemKey(item)}
                  className={cn(
                    "flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm focus-within:ring-2 focus-within:ring-ring",
                    checked ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name={`${inputId}-result`}
                    checked={checked}
                    onChange={() => onSelect(item)}
                    className="sr-only"
                  />
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <CodeLabel code={item.code} codeSystem={item.codeSystem} />
                    <span className="flex gap-1.5">
                      {item.level < 6 && item.codeSystem === "HS" && (
                        <Badge variant="warning">{item.level === 2 ? "Chapter" : "Heading"} — not a complete code</Badge>
                      )}
                      {checked && <Badge variant="success">Selected</Badge>}
                    </span>
                  </span>
                  <span className="break-words text-foreground">{item.description}</span>
                </label>
              );
            })}
          </div>
          {search.data && search.data.meta.totalPages > 1 && <Pagination meta={search.data.meta} onPageChange={setPage} />}
          {items.some((i) => i.sourceType === "DEVELOPMENT_SAMPLE") && (
            <HelperText>
              Source: {items[0].sourceName}. This is a limited sample, not the complete official HS / ITC-HS schedule.
            </HelperText>
          )}
        </>
      )}
    </div>
  );
}
