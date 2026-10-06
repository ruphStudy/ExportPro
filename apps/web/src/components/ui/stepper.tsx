import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** 1-indexed current step. */
  current: number;
  onStepClick?: (step: number) => void;
}

/** Semantic step navigation (nav + ordered list) so screen readers announce "step 2 of 5" correctly. */
export function Stepper({ steps, current, onStepClick }: StepperProps) {
  return (
    <nav aria-label="Onboarding steps">
      <ol className="flex items-center gap-1 overflow-x-auto sm:gap-2">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const isComplete = stepNumber < current;
          const isCurrent = stepNumber === current;
          const clickable = Boolean(onStepClick);

          return (
            <li key={step.label} className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onStepClick?.(stepNumber)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors sm:text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isCurrent && "bg-primary text-primary-foreground",
                  !isCurrent && isComplete && "bg-success/10 text-success",
                  !isCurrent && !isComplete && "bg-muted text-muted-foreground",
                  !clickable && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                    isCurrent && "bg-primary-foreground/20",
                    !isCurrent && isComplete && "bg-success text-success-foreground",
                    !isCurrent && !isComplete && "bg-border",
                  )}
                >
                  {isComplete ? <Check className="size-3" aria-hidden="true" /> : stepNumber}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
              </button>
              {stepNumber < steps.length && <span className="h-px w-3 shrink-0 bg-border sm:w-6" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
