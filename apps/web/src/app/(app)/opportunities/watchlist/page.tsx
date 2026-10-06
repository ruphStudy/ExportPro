"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { countryLabel, PRODUCT_CATEGORIES } from "@exportpro/types";
import { watchlistApi } from "@/lib/api/opportunities";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

function categoryLabel(code: string): string {
  return PRODUCT_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

export default function WatchlistPage() {
  return (
    <RequirePermission permission="opportunities.view">
      <WatchlistContent />
    </RequirePermission>
  );
}

function WatchlistContent() {
  const queryClient = useQueryClient();
  const [removeId, setRemoveId] = React.useState<string | null>(null);
  const watchlist = useQuery({ queryKey: ["opportunities", "watchlist"], queryFn: watchlistApi.list });

  const remove = useMutation({
    mutationFn: (opportunityId: string) => watchlistApi.remove(opportunityId),
    onSuccess: () => {
      toast.success("Removed from watchlist");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "watchlist"] });
      setRemoveId(null);
    },
    onError: (error) => {
      toast.error("Could not remove", toFriendlyErrorMessage(error));
      setRemoveId(null);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Watchlist</PageTitle>
          <HelperText className="mt-1">Opportunities you&apos;ve saved for follow-up.</HelperText>
        </div>
        <Button asChild variant="outline">
          <Link href="/opportunities">Explore Opportunities</Link>
        </Button>
      </div>

      {watchlist.isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : watchlist.isError ? (
        <ErrorState message={toFriendlyErrorMessage(watchlist.error)} onRetry={() => watchlist.refetch()} />
      ) : watchlist.data && watchlist.data.length > 0 ? (
        <div className="flex flex-col gap-3">
          {watchlist.data.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
              <div>
                <Link href={`/opportunities/${item.opportunity.id}`} className="text-sm font-medium text-foreground hover:underline">
                  {item.opportunity.productName} → {countryLabel(item.opportunity.destinationCountryCode)}
                </Link>
                <HelperText>{categoryLabel(item.opportunity.productCategoryCode)}</HelperText>
                <Caption className="mt-1">Saved {new Date(item.createdAt).toLocaleDateString()}</Caption>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-lg font-semibold text-foreground">{item.opportunity.overallScore}</p>
                  <Caption>
                    Confidence {item.opportunity.confidenceScore}
                    {item.opportunity.scoreDelta !== null && (
                      <span className={item.opportunity.scoreDelta >= 0 ? "text-success" : "text-danger"}>
                        {" "}
                        ({item.opportunity.scoreDelta > 0 ? "+" : ""}
                        {item.opportunity.scoreDelta})
                      </span>
                    )}
                  </Caption>
                </div>
                <Badge variant={item.opportunity.source.freshness === "FRESH" ? "success" : "neutral"}>
                  {item.opportunity.source.freshness}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => setRemoveId(item.opportunity.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No saved opportunities yet."
          action={
            <Button asChild>
              <Link href="/opportunities">Explore Opportunities</Link>
            </Button>
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(removeId)}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Remove from watchlist"
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => removeId && remove.mutate(removeId)}
      />
    </div>
  );
}
