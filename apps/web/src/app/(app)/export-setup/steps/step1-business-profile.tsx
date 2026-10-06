"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import type { ExporterProfileSummary, ExporterType, ExportExperience, RiskTolerance } from "@exportpro/types";
import { onboardingApi } from "@/lib/api/onboarding";
import { organizationsApi } from "@/lib/api/organizations";
import { referenceApi } from "@/lib/api/reference";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { RadioCardGroup } from "@/components/ui/radio-card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { HelperText, SectionTitle } from "@/components/ui/typography";

const EXPORTER_TYPE_OPTIONS = [
  { value: "MANUFACTURER", label: "Manufacturer", description: "I manufacture the products I export." },
  { value: "MERCHANT_EXPORTER", label: "Merchant Exporter", description: "I buy from manufacturers and export under my own name." },
  { value: "TRADER", label: "Trader", description: "I trade/broker goods without manufacturing them." },
];

export function Step1BusinessProfile({
  profile,
  onNext,
  canEdit,
}: {
  profile: ExporterProfileSummary;
  onNext: () => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const organization = useQuery({ queryKey: ["organization", "current"], queryFn: organizationsApi.getCurrent });
  const experienceOptions = useQuery({ queryKey: ["reference", "export-experience"], queryFn: referenceApi.exportExperience });
  const riskOptions = useQuery({ queryKey: ["reference", "risk-tolerance"], queryFn: referenceApi.riskTolerance });

  const [exporterType, setExporterType] = React.useState<ExporterType | undefined>(profile.exporterType ?? undefined);
  const [exportExperience, setExportExperience] = React.useState<ExportExperience | "">(profile.exportExperience ?? "");
  const [riskTolerance, setRiskTolerance] = React.useState<RiskTolerance | undefined>(profile.riskTolerance ?? undefined);

  const save = useMutation({
    mutationFn: () =>
      onboardingApi.updateProfile({
        exporterType,
        exportExperience: exportExperience || undefined,
        riskTolerance,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["onboarding"], updated);
      onNext();
    },
    onError: (error) => toast.error("Could not save", toFriendlyErrorMessage(error)),
  });

  if (organization.isLoading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <SectionTitle>Your company</SectionTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings">Edit in Organization Settings</Link>
          </Button>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Company name</dt>
            <dd className="text-foreground">{organization.data?.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Business type</dt>
            <dd className="text-foreground">{organization.data?.businessType ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Country</dt>
            <dd className="text-foreground">{organization.data?.country ?? "Not set"}</dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-col gap-2">
        <SectionTitle>Exporter type</SectionTitle>
        <HelperText>How does your business operate?</HelperText>
        <RadioCardGroup
          name="exporterType"
          aria-label="Exporter type"
          columns={3}
          options={EXPORTER_TYPE_OPTIONS}
          value={exporterType}
          onChange={(v) => canEdit && setExporterType(v as ExporterType)}
        />
      </div>

      <Select
        label="Export experience"
        placeholder="Select your experience"
        value={exportExperience}
        disabled={!canEdit}
        onChange={(e) => setExportExperience(e.target.value as ExportExperience)}
        options={(experienceOptions.data ?? []).map((o) => ({ label: o.label, value: o.code }))}
      />

      <div className="flex flex-col gap-2">
        <SectionTitle>Risk tolerance</SectionTitle>
        <HelperText>How much complexity are you comfortable taking on for a bigger opportunity?</HelperText>
        <RadioCardGroup
          name="riskTolerance"
          aria-label="Risk tolerance"
          columns={3}
          options={(riskOptions.data ?? []).map((o) => ({ value: o.code, label: o.label, description: o.description }))}
          value={riskTolerance}
          onChange={(v) => canEdit && setRiskTolerance(v as RiskTolerance)}
        />
      </div>

      {canEdit && (
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save &amp; Continue
          </Button>
        </div>
      )}
    </div>
  );
}
