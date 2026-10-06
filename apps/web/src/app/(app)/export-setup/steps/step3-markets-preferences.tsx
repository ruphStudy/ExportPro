"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import type {
  ExporterProfileSummary,
  ExportGoal,
  InvestmentRange,
  LogisticsMode,
  ShipmentPreference,
} from "@exportpro/types";
import { onboardingApi, targetCountriesApi } from "@/lib/api/onboarding";
import { referenceApi } from "@/lib/api/reference";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { CheckboxCardGroup } from "@/components/ui/checkbox-card-group";
import { Input } from "@/components/ui/input";
import { MultiSelectSearch } from "@/components/ui/multi-select-search";
import { Select } from "@/components/ui/select";
import { HelperText, Label, SectionTitle } from "@/components/ui/typography";

export function Step3MarketsPreferences({
  profile,
  onNext,
  onBack,
  canEdit,
}: {
  profile: ExporterProfileSummary;
  onNext: () => void;
  onBack: () => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const countries = useQuery({ queryKey: ["reference", "countries"], queryFn: referenceApi.countries });
  const industries = useQuery({ queryKey: ["reference", "industries"], queryFn: referenceApi.industries });
  const investmentRanges = useQuery({ queryKey: ["reference", "investment-ranges"], queryFn: referenceApi.investmentRanges });
  const shipmentPrefs = useQuery({ queryKey: ["reference", "shipment-preferences"], queryFn: referenceApi.shipmentPreferences });
  const logisticsModes = useQuery({ queryKey: ["reference", "logistics-modes"], queryFn: referenceApi.logisticsModes });
  const exportGoals = useQuery({ queryKey: ["reference", "export-goals"], queryFn: referenceApi.exportGoals });
  const targetCountries = useQuery({ queryKey: ["onboarding", "countries"], queryFn: targetCountriesApi.list });

  const currentCountries = (targetCountries.data ?? []).filter((c) => c.relation === "CURRENT").map((c) => c.countryCode);
  const interestedCountries = (targetCountries.data ?? []).filter((c) => c.relation === "INTERESTED").map((c) => c.countryCode);

  const [preferredIndustries, setPreferredIndustries] = React.useState<string[]>(profile.preferredIndustries);
  const [investmentRange, setInvestmentRange] = React.useState<InvestmentRange | "">(profile.investmentRange ?? "");
  const [shipmentPreference, setShipmentPreference] = React.useState<ShipmentPreference | "">(profile.shipmentPreference ?? "");
  const [marginMin, setMarginMin] = React.useState<string>(profile.desiredMarginMin?.toString() ?? "");
  const [marginMax, setMarginMax] = React.useState<string>(profile.desiredMarginMax?.toString() ?? "");
  const [preferredLogistics, setPreferredLogistics] = React.useState<LogisticsMode[]>(profile.preferredLogistics);
  const [goals, setGoals] = React.useState<ExportGoal[]>(profile.exportGoals);

  const setCountries = useMutation({
    mutationFn: targetCountriesApi.upsert,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding", "countries"] }),
    onError: (error) => toast.error("Could not update country", toFriendlyErrorMessage(error)),
  });
  const removeCountry = useMutation({
    mutationFn: targetCountriesApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding", "countries"] }),
  });

  const savePreferences = useMutation({
    mutationFn: () =>
      onboardingApi.updatePreferences({
        preferredIndustries,
        investmentRange: investmentRange || undefined,
        shipmentPreference: shipmentPreference || undefined,
        desiredMarginMin: marginMin ? Number(marginMin) : undefined,
        desiredMarginMax: marginMax ? Number(marginMax) : undefined,
        preferredLogistics,
        exportGoals: goals,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["onboarding"], updated);
      onNext();
    },
    onError: (error) => toast.error("Could not save", toFriendlyErrorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <SectionTitle>Target countries</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MultiSelectSearch
            label="Currently exporting to"
            placeholder="Search countries..."
            options={countries.data ?? []}
            value={currentCountries}
            disabled={!canEdit}
            onChange={(next) => {
              const added = next.find((c) => !currentCountries.includes(c));
              const removed = currentCountries.find((c) => !next.includes(c));
              if (added) setCountries.mutate({ countryCode: added, relation: "CURRENT" });
              if (removed) removeCountry.mutate(removed);
            }}
          />
          <MultiSelectSearch
            label="Interested in exporting to"
            placeholder="Search countries..."
            options={countries.data ?? []}
            value={interestedCountries}
            disabled={!canEdit}
            onChange={(next) => {
              const added = next.find((c) => !interestedCountries.includes(c));
              const removed = interestedCountries.find((c) => !next.includes(c));
              if (added) setCountries.mutate({ countryCode: added, relation: "INTERESTED" });
              if (removed) removeCountry.mutate(removed);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>Preferred industries</SectionTitle>
        <HelperText>Industries/segments you&apos;d like to sell into, if different from your product category.</HelperText>
        <CheckboxCardGroup
          aria-label="Preferred industries"
          columns={3}
          options={(industries.data ?? []).map((i) => ({ value: i.code, label: i.label }))}
          value={preferredIndustries}
          onChange={canEdit ? setPreferredIndustries : () => undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Investment range"
          placeholder="Select a range"
          disabled={!canEdit}
          value={investmentRange}
          onChange={(e) => setInvestmentRange(e.target.value as InvestmentRange)}
          options={(investmentRanges.data ?? []).map((o) => ({ label: o.label, value: o.code }))}
        />
        <Select
          label="Shipment size preference"
          placeholder="Select a preference"
          disabled={!canEdit}
          value={shipmentPreference}
          onChange={(e) => setShipmentPreference(e.target.value as ShipmentPreference)}
          options={(shipmentPrefs.data ?? []).map((o) => ({ label: o.label, value: o.code }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Desired margin (%)</Label>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="Min"
            disabled={!canEdit}
            value={marginMin}
            onChange={(e) => setMarginMin(e.target.value)}
            containerClassName="w-32"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="Max"
            disabled={!canEdit}
            value={marginMax}
            onChange={(e) => setMarginMax(e.target.value)}
            containerClassName="w-32"
          />
        </div>
        <HelperText>A preference only — not a guaranteed outcome.</HelperText>
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>Preferred logistics</SectionTitle>
        <CheckboxCardGroup
          aria-label="Preferred logistics"
          columns={4}
          options={(logisticsModes.data ?? []).map((o) => ({ value: o.code, label: o.label }))}
          value={preferredLogistics}
          onChange={canEdit ? (v) => setPreferredLogistics(v as LogisticsMode[]) : () => undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>Export goals</SectionTitle>
        <HelperText>Select everything that applies — we&apos;ll use this to personalize future recommendations.</HelperText>
        <CheckboxCardGroup
          aria-label="Export goals"
          columns={2}
          options={(exportGoals.data ?? []).map((o) => ({ value: o.code, label: o.label }))}
          value={goals}
          onChange={canEdit ? (v) => setGoals(v as ExportGoal[]) : () => undefined}
        />
      </div>

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {canEdit && (
          <Button onClick={() => savePreferences.mutate()} loading={savePreferences.isPending}>
            Save &amp; Continue
          </Button>
        )}
      </div>
    </div>
  );
}
