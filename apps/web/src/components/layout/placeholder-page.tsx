import { Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HelperText, PageTitle } from "@/components/ui/typography";

export interface PlaceholderPageProps {
  title: string;
  description: string;
  icon?: LucideIcon;
}

/**
 * Shared shell for every nav item that doesn't have real functionality
 * yet. Clearly labeled "Coming soon" — never dressed up to look like a
 * working feature — so it satisfies "no dead/misleading UI" without a
 * one-off page per module.
 */
export function PlaceholderPage({ title, description, icon: Icon = Clock }: PlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle>{title}</PageTitle>
        <Badge variant="info">Coming soon</Badge>
      </div>
      <HelperText>{description}</HelperText>
      <EmptyState
        icon={Icon}
        title={`${title} isn't built yet`}
        description="This module is on the roadmap and will ship in a later sprint."
      />
    </div>
  );
}
