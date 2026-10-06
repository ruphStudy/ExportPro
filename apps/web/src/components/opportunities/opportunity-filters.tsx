"use client";

import { BookmarkPlus } from "lucide-react";
import * as React from "react";
import { COUNTRIES, OpportunitySearchFilters, PRODUCT_CATEGORIES } from "@exportpro/types";
import { SORT_LABELS } from "@/lib/opportunity-labels";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/select";

const COMPETITION_OPTIONS = [
  { label: "Low", value: "LOW" },
  { label: "Moderate", value: "MODERATE" },
  { label: "High", value: "HIGH" },
];
const COMPLIANCE_OPTIONS = [
  { label: "Easy", value: "EASY" },
  { label: "Moderate", value: "MODERATE" },
  { label: "Complex", value: "COMPLEX" },
];
const BUDGET_OPTIONS = [
  { label: "Under ₹1 lakh", value: "UNDER_1L" },
  { label: "Up to ₹5 lakh", value: "L1_5" },
  { label: "Up to ₹10 lakh", value: "L5_10" },
  { label: "Up to ₹25 lakh", value: "L10_25" },
  { label: "Up to ₹50 lakh", value: "L25_50" },
  { label: "Up to ₹1 crore", value: "L50_1CR" },
  { label: "Any", value: "ABOVE_1CR" },
];
const SCORE_THRESHOLDS = [
  { label: "Any", value: "" },
  { label: "50+", value: "50" },
  { label: "70+", value: "70" },
  { label: "85+", value: "85" },
];

export function OpportunityFilters({
  filters,
  onChange,
  onSaveSearch,
}: {
  filters: OpportunitySearchFilters;
  onChange: (next: OpportunitySearchFilters) => void;
  onSaveSearch: () => void;
}) {
  const set = <K extends keyof OpportunitySearchFilters>(key: K, value: OpportunitySearchFilters[K] | "") => {
    onChange({ ...filters, [key]: value === "" ? undefined : value });
  };

  const activeFilterCount = [
    filters.category,
    filters.country,
    filters.budget,
    filters.minMarginScore,
    filters.minGrowthScore,
    filters.competitionLevel,
    filters.complianceDifficulty,
  ].filter((v) => v !== undefined).length;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <FilterBar
        className="flex-1"
        search={{ value: filters.search ?? "", onChange: (v) => set("search", v), placeholder: "Search product, category, or country..." }}
        activeFilterCount={activeFilterCount}
        onClearFilters={() =>
          onChange({ search: filters.search, sort: filters.sort })
        }
      >
        <Select
          placeholder="Category"
          value={filters.category ?? ""}
          onChange={(e) => set("category", e.target.value || undefined)}
          options={PRODUCT_CATEGORIES.map((c) => ({ label: c.label, value: c.code }))}
          containerClassName="w-40"
        />
        <Select
          placeholder="Country"
          value={filters.country ?? ""}
          onChange={(e) => set("country", e.target.value || undefined)}
          options={COUNTRIES.map((c) => ({ label: c.label, value: c.code }))}
          containerClassName="w-40"
        />
        <Select
          placeholder="Budget"
          value={filters.budget ?? ""}
          onChange={(e) => set("budget", (e.target.value || undefined) as OpportunitySearchFilters["budget"])}
          options={BUDGET_OPTIONS}
          containerClassName="w-40"
        />
        <Select
          placeholder="Min margin"
          value={filters.minMarginScore?.toString() ?? ""}
          onChange={(e) => set("minMarginScore", e.target.value ? Number(e.target.value) : undefined)}
          options={SCORE_THRESHOLDS}
          containerClassName="w-32"
        />
        <Select
          placeholder="Min growth"
          value={filters.minGrowthScore?.toString() ?? ""}
          onChange={(e) => set("minGrowthScore", e.target.value ? Number(e.target.value) : undefined)}
          options={SCORE_THRESHOLDS}
          containerClassName="w-32"
        />
        <Select
          placeholder="Competition"
          value={filters.competitionLevel ?? ""}
          onChange={(e) => set("competitionLevel", (e.target.value || undefined) as OpportunitySearchFilters["competitionLevel"])}
          options={COMPETITION_OPTIONS}
          containerClassName="w-36"
        />
        <Select
          placeholder="Compliance"
          value={filters.complianceDifficulty ?? ""}
          onChange={(e) => set("complianceDifficulty", (e.target.value || undefined) as OpportunitySearchFilters["complianceDifficulty"])}
          options={COMPLIANCE_OPTIONS}
          containerClassName="w-36"
        />
      </FilterBar>

      <div className="flex items-center gap-2">
        <Select
          value={filters.sort ?? "BEST"}
          onChange={(e) => set("sort", e.target.value as OpportunitySearchFilters["sort"])}
          options={Object.entries(SORT_LABELS).map(([value, label]) => ({ label, value }))}
          containerClassName="w-44"
        />
        <Button variant="outline" size="sm" onClick={onSaveSearch}>
          <BookmarkPlus className="size-4" aria-hidden="true" />
          Save Search
        </Button>
      </div>
    </div>
  );
}
