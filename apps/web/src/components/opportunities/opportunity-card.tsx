"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { countryLabel, PRODUCT_CATEGORIES, type OpportunitySummary } from "@exportpro/types";
import { watchlistApi } from "@/lib/api/opportunities";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { FRESHNESS_LABELS, SOURCE_TYPE_LABELS } from "@/lib/opportunity-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText } from "@/components/ui/typography";

function categoryLabel(code: string): string {
  return PRODUCT_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

export function OpportunityCard({ opportunity }: { opportunity: OpportunitySummary }) {
  const { data: session } = useSession();
  const canSave = hasPermission(session, "opportunities.save");
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(opportunity.isSaved);

  const save = useMutation({
    mutationFn: () => watchlistApi.save(opportunity.id),
    onSuccess: () => {
      setSaved(true);
      toast.success("Opportunity saved");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "watchlist"] });
    },
    onError: (error) => toast.error("Could not save", toFriendlyErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => watchlistApi.remove(opportunity.id),
    onSuccess: () => {
      setSaved(false);
      toast.success("Removed from watchlist");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "watchlist"] });
    },
    onError: (error) => toast.error("Could not remove", toFriendlyErrorMessage(error)),
  });

  const freshness = FRESHNESS_LABELS[opportunity.source.freshness];
  const delta = opportunity.scoreDelta;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{opportunity.productName}</p>
          <HelperText>
            {categoryLabel(opportunity.productCategoryCode)} → {countryLabel(opportunity.destinationCountryCode)}
          </HelperText>
        </div>
        {canSave && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={saved ? "Remove from watchlist" : "Save opportunity"}
            onClick={() => (saved ? remove.mutate() : save.mutate())}
            loading={save.isPending || remove.isPending}
          >
            {saved ? <BookmarkCheck className="size-4 text-primary" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
          </Button>
        )}
      </div>

      <div className="flex items-end gap-3">
        <span className="text-3xl font-semibold text-foreground">{opportunity.overallScore}</span>
        <Caption className="mb-1">/ 100 opportunity score</Caption>
        {delta !== null && (
          <span
            className={`mb-1 flex items-center gap-0.5 text-xs font-medium ${delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted-foreground"}`}
          >
            {delta > 0 ? <TrendingUp className="size-3.5" aria-hidden="true" /> : delta < 0 ? <TrendingDown className="size-3.5" aria-hidden="true" /> : <Minus className="size-3.5" aria-hidden="true" />}
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </div>
      <HelperText>Confidence: {opportunity.confidenceScore}/100</HelperText>

      {opportunity.badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {opportunity.badges.map((badge) => (
            <Badge key={badge} variant={badge === "Recommended" ? "info" : "success"}>
              {badge}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <Badge variant={freshness.variant}>{freshness.label}</Badge>
          <Caption>{SOURCE_TYPE_LABELS[opportunity.source.sourceType]}</Caption>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/opportunities/${opportunity.id}`}>View details</Link>
        </Button>
      </div>
    </Card>
  );
}
