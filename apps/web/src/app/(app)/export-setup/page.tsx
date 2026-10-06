"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { onboardingApi } from "@/lib/api/onboarding";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { HelperText, PageTitle } from "@/components/ui/typography";
import { RequirePermission } from "@/components/layout/require-permission";
import { Step1BusinessProfile } from "./steps/step1-business-profile";
import { Step2Products } from "./steps/step2-products";
import { Step3MarketsPreferences } from "./steps/step3-markets-preferences";
import { Step4Registrations } from "./steps/step4-registrations";
import { Step5ReadinessReview } from "./steps/step5-readiness-review";

const STEPS = [
  { label: "Business Profile" },
  { label: "Products" },
  { label: "Markets & Preferences" },
  { label: "Registrations" },
  { label: "Readiness Review" },
];

export default function ExportSetupPage() {
  return (
    <RequirePermission permission="onboarding.view">
      <ExportSetupContent />
    </RequirePermission>
  );
}

function ExportSetupContent() {
  const { data: session } = useSession();
  const canEdit = hasPermission(session, "onboarding.update");
  const profile = useQuery({ queryKey: ["onboarding"], queryFn: onboardingApi.get });
  // null = "follow the org's saved progress"; once the user clicks a step,
  // that click wins even after a background refetch of `profile`.
  const [manualStep, setManualStep] = React.useState<number | null>(null);
  const step = manualStep ?? profile.data?.currentStep ?? 1;

  const goToStep = (next: number) => {
    setManualStep(next);
    if (canEdit) onboardingApi.updateProgress({ currentStep: next }).catch(() => undefined);
  };

  if (profile.isLoading) return <PageSkeleton />;
  if (profile.isError || !profile.data) {
    return <ErrorState message={toFriendlyErrorMessage(profile.error)} onRetry={() => profile.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PageTitle>Export Setup</PageTitle>
            {profile.data.onboardingStatus === "COMPLETED" && <Badge variant="success">Complete</Badge>}
          </div>
          <HelperText className="mt-1">
            Tell us about your business so we can personalize opportunities, products, and markets later.
          </HelperText>
        </div>
      </div>

      <Stepper steps={STEPS} current={step} onStepClick={goToStep} />

      {step === 1 && <Step1BusinessProfile profile={profile.data} canEdit={canEdit} onNext={() => goToStep(2)} />}
      {step === 2 && (
        <Step2Products profile={profile.data} canEdit={canEdit} onBack={() => goToStep(1)} onNext={() => goToStep(3)} />
      )}
      {step === 3 && (
        <Step3MarketsPreferences
          profile={profile.data}
          canEdit={canEdit}
          onBack={() => goToStep(2)}
          onNext={() => goToStep(4)}
        />
      )}
      {step === 4 && <Step4Registrations canEdit={canEdit} onBack={() => goToStep(3)} onNext={() => goToStep(5)} />}
      {step === 5 && <Step5ReadinessReview profile={profile.data} onBack={() => goToStep(4)} onGoToStep={goToStep} />}
    </div>
  );
}
