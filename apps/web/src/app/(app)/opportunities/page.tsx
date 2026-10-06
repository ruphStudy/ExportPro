"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { OpportunitySearchFilters, OpportunitySort } from "@exportpro/types";
import { opportunitiesApi, savedSearchesApi } from "@/lib/api/opportunities";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { SECTION_LABELS } from "@/lib/opportunity-labels";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

function parseFiltersFromParams(params: URLSearchParams): OpportunitySearchFilters {
  const filters: OpportunitySearchFilters = {};
  const str = (k: string) => params.get(k) ?? undefined;
  filters.search = str("search");
  filters.category = str("category");
  filters.country = str("country");
  filters.budget = str("budget") as OpportunitySearchFilters["budget"];
  filters.competitionLevel = str("competitionLevel") as OpportunitySearchFilters["competitionLevel"];
  filters.complianceDifficulty = str("complianceDifficulty") as OpportunitySearchFilters["complianceDifficulty"];
  filters.sort = (str("sort") as OpportunitySort) ?? "BEST";
  const margin = str("minMarginScore");
  const growth = str("minGrowthScore");
  if (margin) filters.minMarginScore = Number(margin);
  if (growth) filters.minGrowthScore = Number(growth);
  return filters;
}

function hasActiveQuery(filters: OpportunitySearchFilters): boolean {
  return Boolean(
    filters.search ||
      filters.category ||
      filters.country ||
      filters.budget ||
      filters.minMarginScore !== undefined ||
      filters.minGrowthScore !== undefined ||
      filters.competitionLevel ||
      filters.complianceDifficulty,
  );
}

const saveSearchSchema = z.object({ name: z.string().min(1, "Enter a name.") });
type SaveSearchValues = z.infer<typeof saveSearchSchema>;

export default function OpportunitiesPage() {
  return (
    <RequirePermission permission="opportunities.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <OpportunitiesContent />
      </Suspense>
    </RequirePermission>
  );
}

function OpportunitiesContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canManageSearches = hasPermission(session, "opportunities.manage_saved_searches");

  const [filters, setFilters] = React.useState<OpportunitySearchFilters>(() => parseFiltersFromParams(searchParams));
  const [page, setPage] = React.useState(1);
  const [saveSearchOpen, setSaveSearchOpen] = React.useState(false);
  const [deleteSearchId, setDeleteSearchId] = React.useState<string | null>(null);

  const updateFilters = (next: OpportunitySearchFilters) => {
    setFilters(next);
    setPage(1);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const active = hasActiveQuery(filters);

  const discovery = useQuery({ queryKey: ["opportunities", "discovery"], queryFn: opportunitiesApi.discovery, enabled: !active });
  const search = useQuery({
    queryKey: ["opportunities", "search", filters, page],
    queryFn: () => opportunitiesApi.search({ ...filters, page, pageSize: 20 }),
    enabled: active,
  });
  const savedSearches = useQuery({ queryKey: ["opportunities", "saved-searches"], queryFn: savedSearchesApi.list });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SaveSearchValues>({ resolver: zodResolver(saveSearchSchema) });

  const createSearch = useMutation({
    mutationFn: (values: SaveSearchValues) => savedSearchesApi.create({ name: values.name, query: filters }),
    onSuccess: () => {
      toast.success("Search saved");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "saved-searches"] });
      setSaveSearchOpen(false);
      reset();
    },
    onError: (error) => toast.error("Could not save search", toFriendlyErrorMessage(error)),
  });

  const deleteSearch = useMutation({
    mutationFn: (id: string) => savedSearchesApi.remove(id),
    onSuccess: () => {
      toast.success("Saved search deleted");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "saved-searches"] });
      setDeleteSearchId(null);
    },
    onError: (error) => toast.error("Could not delete", toFriendlyErrorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Opportunities</PageTitle>
          <HelperText className="mt-1">Discover product × market opportunities based on structured demo signals.</HelperText>
        </div>
        <Button asChild variant="outline">
          <Link href="/opportunities/watchlist">Watchlist</Link>
        </Button>
      </div>

      <OpportunityFilters filters={filters} onChange={updateFilters} onSaveSearch={() => setSaveSearchOpen(true)} />

      {savedSearches.data && savedSearches.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Caption>Saved searches:</Caption>
          {savedSearches.data.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs">
              <button type="button" className="text-foreground hover:underline" onClick={() => updateFilters(s.query)}>
                {s.name}
              </button>
              {canManageSearches && (
                <button
                  type="button"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => setDeleteSearchId(s.id)}
                  className="text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {active ? (
        <div className="flex flex-col gap-4">
          {search.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          ) : search.isError ? (
            <ErrorState message={toFriendlyErrorMessage(search.error)} onRetry={() => search.refetch()} />
          ) : search.data && search.data.items.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {search.data.items.map((o) => (
                  <OpportunityCard key={o.id} opportunity={o} />
                ))}
              </div>
              <Pagination meta={search.data.meta} onPageChange={setPage} />
            </>
          ) : (
            <EmptyState
              title="No matching opportunities"
              description="Try widening your filters."
              action={
                <Button variant="outline" onClick={() => updateFilters({ sort: filters.sort })}>
                  Clear filters
                </Button>
              }
            />
          )}
        </div>
      ) : discovery.isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : discovery.isError || !discovery.data ? (
        <ErrorState message={toFriendlyErrorMessage(discovery.error)} onRetry={() => discovery.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <Caption>{discovery.data.demoDataNotice}</Caption>
          {(Object.keys(discovery.data.sections) as (keyof typeof discovery.data.sections)[]).map((key) => {
            const items = discovery.data!.sections[key];
            if (items.length === 0) return null;
            return (
              <Card key={key} className="p-4">
                <SectionTitle>{SECTION_LABELS[key]}</SectionTitle>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {items.map((o) => (
                    <OpportunityCard key={`${key}-${o.id}`} opportunity={o} />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={saveSearchOpen} onOpenChange={setSaveSearchOpen} title="Save search" description="Save your current filters to reopen later.">
        <form onSubmit={handleSubmit((values) => createSearch.mutate(values))} className="flex flex-col gap-4" noValidate>
          <Input label="Name" required placeholder="e.g. Spices to UAE, low competition" error={errors.name?.message} {...register("name")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setSaveSearchOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || createSearch.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteSearchId)}
        onOpenChange={(open) => !open && setDeleteSearchId(null)}
        title="Delete saved search"
        confirmLabel="Delete"
        destructive
        loading={deleteSearch.isPending}
        onConfirm={() => deleteSearchId && deleteSearch.mutate(deleteSearchId)}
      />
    </div>
  );
}
