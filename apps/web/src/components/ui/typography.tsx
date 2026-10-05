import * as React from "react";
import { cn } from "@/lib/utils";

export function PageTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cn("text-2xl font-semibold tracking-tight text-foreground", className)} {...props} />;
}

export function SectionTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold text-foreground", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-foreground", className)} {...props} />;
}

export function BodyText({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-foreground", className)} {...props} />;
}

export function HelperText({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function Caption({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function StatValue({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-3xl font-semibold tracking-tight text-foreground", className)} {...props} />;
}
