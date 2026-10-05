import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { CardTitle, Caption, HelperText, StatValue } from "./typography";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-2 p-4 pb-0", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CompactCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn("p-3", className)} {...props} />;
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: { direction: "up" | "down"; label: string };
  className?: string;
}

export function StatCard({ label, value, icon: Icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between">
        <Caption>{label}</Caption>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <StatValue>{value}</StatValue>
        {trend && (
          <span className={cn("text-xs font-medium", trend.direction === "up" ? "text-success" : "text-danger")}>
            {trend.direction === "up" ? "▲" : "▼"} {trend.label}
          </span>
        )}
      </div>
    </Card>
  );
}

export interface ActionableCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ActionableCard({ title, description, icon: Icon, action, onClick, className }: ActionableCardProps) {
  const interactive = Boolean(onClick);
  return (
    <Card
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") onClick?.();
            }
          : undefined
      }
      className={cn(
        "p-4",
        interactive && "cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="rounded-md bg-muted p-2">
            <Icon className="size-4 text-foreground" aria-hidden="true" />
          </div>
        )}
        <div className="flex-1">
          <CardTitle>{title}</CardTitle>
          {description && <HelperText className="mt-1">{description}</HelperText>}
        </div>
        {action}
      </div>
    </Card>
  );
}
