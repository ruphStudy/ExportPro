"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, CheckCircle2, Minus, Sparkles, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { countryLabel, PRODUCT_CATEGORIES } from "@exportpro/types";
import { opportunitiesApi, watchlistApi } from "@/lib/api/opportunities";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { FRESHNESS_LABELS, SOURCE_TYPE_LABELS } from "@/lib/opportunity-labels";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { OpportunityRadar } from "@/components/opportunities/opportunity-radar";
import { ProvenanceBadge } from "@/components/provenance/provenance";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

function categoryLabel(code: string): string {
  return PRODUCT_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}

export default function OpportunityDetailPage() {
  return (
    <RequirePermission permission="opportunities.view">
      <OpportunityDetailContent />
    </RequirePermission>
  );
}

function OpportunityDetailContent() {
  const params = useParams<{ id: string }>();
  const { data: session } = useSession();
  const canSave = hasPermission(session, "opportunities.save");
  const canAnalyzeProduct = hasPermission(session, "products.analyze");
  const canViewIntelligence = hasPermission(session, "product_intelligence.view") && hasPermission(session, "products.view");
  const queryClient = useQueryClient();

  const detail = useQuery({ queryKey: ["opportunities", "detail", params.id], queryFn: () => opportunitiesApi.getById(params.id) });
  // Entry to Product Intelligence only when the org has already saved this product (same name); nothing is created here.
  const savedProduct = useQuery({
    queryKey: ["products", "list", "for-opportunity", detail.data?.productName],
    queryFn: () => productsApi.list({ q: detail.data!.productName, pageSize: 5 }),
    enabled: canViewIntelligence && Boolean(detail.data),
    select: (r) => r.items.find((p) => p.displayName.toLowerCase() === detail.data!.productName.toLowerCase()) ?? null,
  });

  const save = useMutation({
    mutationFn: () => watchlistApi.save(params.id),
    onSuccess: () => {
      toast.success("Opportunity saved");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "detail", params.id] });
      queryClient.invalidateQueries({ queryKey: ["opportunities", "watchlist"] });
    },
    onError: (error) => toast.error("Could not save", toFriendlyErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => watchlistApi.remove(params.id),
    onSuccess: () => {
      toast.success("Removed from watchlist");
      queryClient.invalidateQueries({ queryKey: ["opportunities", "detail", params.id] });
      queryClient.invalidateQueries({ queryKey: ["opportunities", "watchlist"] });
    },
    onError: (error) => toast.error("Could not remove", toFriendlyErrorMessage(error)),
  });

  if (detail.isLoading) return <PageSkeleton />;
  if (detail.isError || !detail.data) {
    return <ErrorState title="Opportunity not found" message={toFriendlyErrorMessage(detail.error)} onRetry={() => detail.refetch()} />;
  }

  const o = detail.data;
  const freshness = FRESHNESS_LABELS[o.source.freshness];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle>
            {o.productName} → {countryLabel(o.destinationCountryCode)}
          </PageTitle>
          <HelperText className="mt-1">{categoryLabel(o.productCategoryCode)}</HelperText>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.badges.map((badge) => (
              <Badge key={badge} variant={badge === "Recommended" ? "info" : "success"}>
                {badge}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedProduct.data && (
            <Button asChild variant="outline">
              <Link href={`/products/${savedProduct.data.id}/intelligence`}>View Product Intelligence</Link>
            </Button>
          )}
          {savedProduct.data && hasPermission(session, "country_intelligence.view") && (
            // Only for an already-saved product; the analysis page itself handles unsupported product/country pairs.
            <Button asChild variant="outline">
              <Link href={`/products/${savedProduct.data.id}/markets/${o.destinationCountryCode}`}>View Deep Market Analysis</Link>
            </Button>
          )}
          {canAnalyzeProduct && !savedProduct.data && (
            // Only prefills the analysis form — nothing is classified, saved or changed on the opportunity.
            <Button asChild variant="outline">
              <Link
                href={`/products/analyze?${new URLSearchParams({ input: o.productName, category: o.productCategoryCode, opportunityId: o.id })}`}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Analyze Product
              </Link>
            </Button>
          )}
          {canSave && (
            <Button onClick={() => (o.isSaved ? remove.mutate() : save.mutate())} loading={save.isPending || remove.isPending}>
              {o.isSaved ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
              {o.isSaved ? "Saved" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <Caption>Opportunity Score</Caption>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-4xl font-semibold text-foreground">{o.overallScore}</span>
            {o.scoreDelta !== null && (
              <span
                className={`flex items-center gap-0.5 text-sm font-medium ${o.scoreDelta > 0 ? "text-success" : o.scoreDelta < 0 ? "text-danger" : "text-muted-foreground"}`}
              >
                {o.scoreDelta > 0 ? <TrendingUp className="size-4" aria-hidden="true" /> : o.scoreDelta < 0 ? <TrendingDown className="size-4" aria-hidden="true" /> : <Minus className="size-4" aria-hidden="true" />}
                {o.scoreDelta > 0 ? "+" : ""}
                {o.scoreDelta}
              </span>
            )}
          </div>
          <HelperText>out of 100</HelperText>
        </Card>
        <Card className="p-4">
          <Caption>Data Confidence</Caption>
          <p className="mt-1 text-4xl font-semibold text-foreground">{o.confidenceScore}</p>
          <HelperText>Reflects source freshness, not business attractiveness</HelperText>
        </Card>
        <Card className="p-4">
          <Caption>Personalized Relevance</Caption>
          <p className="mt-1 text-4xl font-semibold text-foreground">{o.personalizedRelevance ?? "—"}</p>
          <HelperText>{o.personalizedRelevance === null ? "Complete Export Setup for personalization" : "Based on your exporter profile"}</HelperText>
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle>Opportunity Radar</SectionTitle>
        <CardContent className="px-0">
          <OpportunityRadar components={o.components} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Why this score?</SectionTitle>
          <ul className="mt-3 flex flex-col gap-2">
            {o.explanation.positives.map((reason) => (
              <li key={reason} className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                {reason}
              </li>
            ))}
            {o.explanation.negatives.map((reason) => (
              <li key={reason} className="flex items-center gap-2 text-sm text-danger">
                <XCircle className="size-4 shrink-0" aria-hidden="true" />
                {reason}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <SectionTitle>Personalization &amp; score change</SectionTitle>
          {o.personalizationReasons.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {o.personalizationReasons.map((reason) => (
                <li key={reason} className="text-sm text-foreground">
                  • {reason}
                </li>
              ))}
            </ul>
          ) : (
            <HelperText className="mt-2">No personalization signals yet.</HelperText>
          )}
          {o.scoreDeltaReasons.length > 0 && (
            <>
              <HelperText className="mt-4 font-medium text-foreground">Why the score changed:</HelperText>
              <ul className="mt-1 flex flex-col gap-1">
                {o.scoreDeltaReasons.map((reason) => (
                  <li key={reason} className="text-xs text-muted-foreground">
                    {reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle>
          Source &amp; freshness{" "}
          <ProvenanceBadge
            className="ml-1 align-middle"
            p={{
              sourceId: null, sourceCode: "EXPORTPRO_DEMO_OPPORTUNITIES", sourceName: o.source.sourceName,
              sourceType: o.source.sourceType === "DEMO" ? "DEMO" : "PUBLIC", authority: "ExportPro", official: o.source.sourceType === "OFFICIAL",
              sourceQuality: o.source.sourceType === "DEMO" ? "DEMO" : "C", sourceDate: o.source.sourceDate, lastIngestedAt: o.source.lastUpdatedAt,
              freshness: o.source.freshness, confidence: o.confidenceScore, provenanceType: o.source.sourceType === "DEMO" ? "DEMO" : "SOURCE_NORMALIZED",
              datasetVersion: null, derived: false, methodology: null,
            }}
          />
        </SectionTitle>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Source</dt>
            <dd className="text-foreground">{SOURCE_TYPE_LABELS[o.source.sourceType]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source name</dt>
            <dd className="text-foreground">{o.source.sourceName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source date</dt>
            <dd className="text-foreground">{new Date(o.source.sourceDate).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Freshness</dt>
            <dd>
              <Badge variant={freshness.variant}>{freshness.label}</Badge>
            </dd>
          </div>
        </dl>
        {o.source.sourceType === "DEMO" && (
          <HelperText className="mt-3">Demo opportunity dataset — synthetic sample data, not official trade statistics.</HelperText>
        )}
      </Card>
    </div>
  );
}
