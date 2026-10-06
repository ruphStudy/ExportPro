import type { FreshnessStatus, OpportunitySort, OpportunitySourceType } from "@exportpro/types";
import type { BadgeProps } from "@/components/ui/badge";

export const FRESHNESS_LABELS: Record<FreshnessStatus, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  FRESH: { label: "Fresh", variant: "success" },
  RECENT: { label: "Recent", variant: "info" },
  STALE: { label: "Stale", variant: "warning" },
  UNKNOWN: { label: "Unknown freshness", variant: "neutral" },
};

export const SOURCE_TYPE_LABELS: Record<OpportunitySourceType, string> = {
  DEMO: "Demo data",
  OFFICIAL: "Official source",
  PUBLIC_DATA: "Public dataset",
  PARTNER: "Partner data",
  INTERNAL: "Internal dataset",
  AI_DERIVED: "AI-derived estimate",
};

export const SORT_LABELS: Record<OpportunitySort, string> = {
  BEST: "Best Opportunity",
  GROWTH: "Highest Growth",
  LOW_COMPETITION: "Lowest Competition",
  HIGH_MARGIN: "Highest Margin",
  CONFIDENCE: "Highest Confidence",
  RECENT: "Recently Updated",
};

export const SECTION_LABELS: Record<string, string> = {
  topOpportunities: "Top Opportunities",
  trendingProducts: "Trending Products",
  fastestGrowing: "Fastest Growing",
  beginnerFriendly: "Beginner Friendly",
  lowCompetition: "Low Competition",
  highPotentialMargin: "High Potential Margin",
  recommendedForYou: "Recommended For You",
};
