"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { SectionTitle } from "./typography";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  side?: "left" | "right";
  children?: React.ReactNode;
  className?: string;
}

/** Same Radix Dialog primitive as Modal, anchored to an edge instead of centered — used for mobile nav and filter panels. */
export function Drawer({ open, onOpenChange, title, side = "right", children, className }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 z-50 flex w-full max-w-xs flex-col bg-surface shadow-lg focus:outline-none",
            side === "right" ? "right-0 border-l border-border" : "left-0 border-r border-border",
            className,
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-4">
            {title ? (
              <Dialog.Title asChild>
                <SectionTitle>{title}</SectionTitle>
              </Dialog.Title>
            ) : (
              <Dialog.Title className="sr-only">Panel</Dialog.Title>
            )}
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
