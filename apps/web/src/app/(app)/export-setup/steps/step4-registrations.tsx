"use client";

import { useQuery } from "@tanstack/react-query";
import { registrationsApi } from "@/lib/api/onboarding";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/ui/typography";
import { CertificationsManager } from "./certifications-manager";
import { RegistrationCard } from "./registration-card";

export function Step4Registrations({ onNext, onBack, canEdit }: { onNext: () => void; onBack: () => void; canEdit: boolean }) {
  const registrations = useQuery({ queryKey: ["onboarding", "registrations"], queryFn: registrationsApi.list });
  const byType = Object.fromEntries((registrations.data ?? []).map((r) => [r.type, r]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle>Registrations</SectionTitle>
      </div>

      {registrations.isLoading ? (
        <TableSkeleton rows={4} columns={1} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RegistrationCard
            type="IEC"
            title="IEC"
            description="Import Export Code — required to transact internationally from India."
            registration={byType.IEC}
            canEdit={canEdit}
          />
          <RegistrationCard
            type="GST"
            title="GST"
            description="Goods and Services Tax registration."
            registration={byType.GST}
            canEdit={canEdit}
          />
          <RegistrationCard
            type="FSSAI"
            title="FSSAI"
            description="Food safety license — relevant for food, beverage, and spice categories."
            registration={byType.FSSAI}
            canEdit={canEdit}
          />
          <RegistrationCard
            type="APEDA"
            title="APEDA"
            description="Agricultural & processed food export registration."
            registration={byType.APEDA}
            canEdit={canEdit}
          />
        </div>
      )}

      <CertificationsManager canEdit={canEdit} />

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Continue to Readiness Review</Button>
      </div>
    </div>
  );
}
