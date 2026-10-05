import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { HelperText, SectionTitle } from "./typography";

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this. Please try again.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 p-10 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-danger/10 p-3">
        <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
      </div>
      <SectionTitle className="mt-2">{title}</SectionTitle>
      <HelperText className="max-w-sm">{message}</HelperText>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
