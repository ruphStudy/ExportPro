"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Single toast system for the app — mounted once in the root layout.
 * Call sites use `toast()` from lib/toast.ts, never sonner directly,
 * so the styling/API stays consistent if the library is ever swapped.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "rounded-md border border-border bg-surface text-foreground shadow-md",
          title: "text-sm font-medium",
          description: "text-xs text-muted-foreground",
        },
      }}
    />
  );
}
