"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { onboardingApi } from "@/lib/api/onboarding";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

/**
 * Dashboard integration for Sprint 3 — see ARCHITECTURE.md "Dashboard
 * Integration". Deliberately small: a CTA while onboarding is
 * incomplete, a compact readiness badge once it's done. This never
 * replaces the dashboard itself.
 */
export function ExportReadinessSummary() {
  const { data: session } = useSession();
  const canView = hasPermission(session, "onboarding.view");

  const profile = useQuery({ queryKey: ["onboarding"], queryFn: onboardingApi.get, enabled: canView });
  const readiness = useQuery({ queryKey: ["onboarding", "readiness"], queryFn: onboardingApi.readiness, enabled: canView });

  if (!canView) return null;

  if (profile.isLoading || readiness.isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-3 h-2 w-full" />
      </Card>
    );
  }
  if (profile.isError || readiness.isError || !profile.data || !readiness.data) return null;

  const isComplete = profile.data.onboardingStatus === "COMPLETED";
  const topActions = readiness.data.missingActions.slice(0, 3);

  if (isComplete) {
    return (
      <Card className="p-4">
        <CardContent className="flex items-center justify-between gap-3 px-0">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="size-5 text-success" aria-hidden="true" />
            <div>
              <SectionTitle>Export Readiness: {readiness.data.score}%</SectionTitle>
              <Caption>{readiness.data.levelLabel}</Caption>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/export-setup">
              View details
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <SectionTitle>Complete Export Setup</SectionTitle>
            <Badge variant="warning">{readiness.data.score}% complete</Badge>
          </div>
          <HelperText className="mt-1">Finish your exporter profile to unlock personalized recommendations later.</HelperText>
        </div>
        <Button asChild size="sm">
          <Link href="/export-setup">
            Continue setup
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <Progress value={readiness.data.score} className="mt-3" label="Export setup progress" />
      {topActions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {topActions.map((action, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              • {action.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
