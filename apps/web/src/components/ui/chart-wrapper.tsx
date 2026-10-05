import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";
import { CardTitle, HelperText } from "./typography";

export interface ChartWrapperProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  children?: React.ReactNode;
  className?: string;
  /** Fixed height so loading/empty/content states don't jump around while a real chart library is wired up later. */
  height?: number;
}

/**
 * No chart library is installed yet (none existed in the repo to reuse,
 * and Sprint 1 has no real analytics data to plot) — this wrapper is
 * the slot a future chart (e.g. Recharts) renders into as `children`.
 */
export function ChartWrapper({
  title,
  subtitle,
  action,
  isLoading,
  isEmpty,
  emptyMessage = "No data to display yet.",
  children,
  className,
  height = 280,
}: ChartWrapperProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle && <HelperText className="mt-0.5">{subtitle}</HelperText>}
        </div>
        {action}
      </div>
      <div style={{ height }} className="mt-4 flex items-center justify-center">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : isEmpty ? (
          <EmptyState title={emptyMessage} className="w-full border-none p-0" />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
