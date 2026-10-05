import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { HelperText, SectionTitle } from "./typography";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-center", className)}>
      <div className="rounded-full bg-muted p-3">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <SectionTitle className="mt-2">{title}</SectionTitle>
      {description && <HelperText className="max-w-sm">{description}</HelperText>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
