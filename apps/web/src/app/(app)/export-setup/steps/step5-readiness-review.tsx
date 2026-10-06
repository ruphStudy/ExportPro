"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import * as React from "react";
import type { ExporterProfileSummary, ReadinessSectionKey, RecommendationPriority } from "@exportpro/types";
import { onboardingApi } from "@/lib/api/onboarding";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Caption, HelperText, SectionTitle, StatValue } from "@/components/ui/typography";

const SECTION_TO_STEP: Record<ReadinessSectionKey, number> = {
  business_profile: 1,
  products: 2,
  markets: 3,
  commercial_preferences: 3,
  registrations: 4,
  certifications: 4,
};

const PRIORITY_BADGE: Record<RecommendationPriority, { label: string; variant: "danger" | "warning" | "info" }> = {
  CRITICAL: { label: "Critical", variant: "danger" },
  IMPORTANT: { label: "Important", variant: "warning" },
  RECOMMENDED: { label: "Recommended", variant: "info" },
};

export function Step5ReadinessReview({
  profile,
  onBack,
  onGoToStep,
}: {
  profile: ExporterProfileSummary;
  onBack: () => void;
  onGoToStep: (step: number) => void;
}) {
  const queryClient = useQueryClient();
  const readiness = useQuery({ queryKey: ["onboarding", "readiness"], queryFn: onboardingApi.readiness });

  const complete = useMutation({
    mutationFn: onboardingApi.complete,
    onSuccess: (updated) => {
      queryClient.setQueryData(["onboarding"], updated);
      toast.success("Export setup complete", "You can return and update this anytime.");
    },
    onError: (error) => toast.error("Could not complete onboarding", toFriendlyErrorMessage(error)),
  });

  if (readiness.isLoading) return <PageSkeleton />;
  if (readiness.isError || !readiness.data) {
    return <ErrorState message={toFriendlyErrorMessage(readiness.error)} onRetry={() => readiness.refetch()} />;
  }

  const data = readiness.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Caption>Export Readiness</Caption>
        <StatValue className="text-5xl">{data.score}%</StatValue>
        <Badge variant={data.score >= 80 ? "success" : data.score >= 60 ? "info" : data.score >= 40 ? "warning" : "neutral"}>
          {data.levelLabel}
        </Badge>
        <HelperText className="max-w-md">
          This reflects how complete your onboarding setup is — it is not a legal or government approval to export.
        </HelperText>
        <Progress value={data.score} className="mt-2 w-full max-w-md" label="Export readiness" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.sections.map((section) => (
          <Card key={section.key} className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>{section.label}</SectionTitle>
              <Button variant="ghost" size="sm" onClick={() => onGoToStep(SECTION_TO_STEP[section.key])}>
                Edit
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Progress value={section.score} max={section.maxScore} className="flex-1" />
              <Caption className="shrink-0">
                {section.score}/{section.maxScore}
              </Caption>
            </div>
            <ul className="mt-3 flex flex-col gap-1">
              {section.complete.map((item) => (
                <li key={item} className="flex items-center gap-2 text-xs text-success">
                  <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
              {section.missing.map((item) => (
                <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Circle className="size-3.5 shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {data.missingActions.length > 0 && (
        <Card className="p-4">
          <SectionTitle>Recommended next actions</SectionTitle>
          <ul className="mt-3 flex flex-col gap-2">
            {data.missingActions.map((action, index) => {
              const badge = PRIORITY_BADGE[action.priority];
              return (
                <li key={index} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm text-foreground">{action.message}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => onGoToStep(SECTION_TO_STEP[action.section])}>
                      Fix
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {profile.onboardingStatus === "COMPLETED" ? (
          <Badge variant="success" className="px-3 py-1.5">
            Onboarding complete
          </Badge>
        ) : (
          <Button onClick={() => complete.mutate()} loading={complete.isPending}>
            Finish Onboarding
          </Button>
        )}
      </div>
    </div>
  );
}
