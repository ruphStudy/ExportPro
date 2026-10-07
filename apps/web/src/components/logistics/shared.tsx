"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type {
  BuyerUpdateStatus,
  FieldSourced,
  FreightQuoteStatus,
  Permission,
  ShipmentExceptionSeverity,
  ShipmentHealth,
  ShipmentMilestoneStatus,
  ShipmentStatus,
  TrackingSource,
} from "@exportpro/types";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type V = "neutral" | "success" | "warning" | "danger" | "info";
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export const SHIPMENT_STATUS: Record<ShipmentStatus, { label: string; variant: V }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  PLANNED: { label: "Planned", variant: "neutral" },
  BOOKED: { label: "Booked", variant: "info" },
  READY_FOR_PICKUP: { label: "Ready for pickup", variant: "info" },
  PICKED_UP: { label: "Picked up", variant: "info" },
  CUSTOMS_PROCESSING: { label: "Customs processing", variant: "info" },
  CUSTOMS_CLEARED: { label: "Customs cleared", variant: "info" },
  AT_ORIGIN_PORT: { label: "At origin port", variant: "info" },
  DEPARTED: { label: "Departed", variant: "info" },
  IN_TRANSIT: { label: "In transit", variant: "info" },
  TRANSSHIPMENT: { label: "Transshipment", variant: "info" },
  ARRIVED_DESTINATION: { label: "Arrived at destination", variant: "info" },
  OUT_FOR_DELIVERY: { label: "Out for delivery", variant: "info" },
  DELIVERED: { label: "Delivered", variant: "success" },
  ON_HOLD: { label: "On hold", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

export const HEALTH: Record<ShipmentHealth, { label: string; variant: V }> = {
  ON_TRACK: { label: "On track", variant: "success" },
  AT_RISK: { label: "At risk", variant: "warning" },
  DELAYED: { label: "Delayed", variant: "warning" },
  BLOCKED: { label: "Blocked", variant: "danger" },
};

export const QUOTE_STATUS: Record<FreightQuoteStatus, { label: string; variant: V }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  REQUESTED: { label: "Requested", variant: "neutral" },
  RECEIVED: { label: "Received", variant: "info" },
  VALID: { label: "Valid", variant: "success" },
  EXPIRED: { label: "Expired", variant: "danger" },
  SELECTED: { label: "Selected", variant: "success" },
  REJECTED: { label: "Rejected", variant: "neutral" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

export const MILESTONE_STATUS: Record<ShipmentMilestoneStatus, { label: string; variant: V }> = {
  NOT_STARTED: { label: "Not started", variant: "neutral" },
  PLANNED: { label: "Planned", variant: "neutral" },
  IN_PROGRESS: { label: "In progress", variant: "info" },
  COMPLETED: { label: "Completed", variant: "success" },
  DELAYED: { label: "Delayed", variant: "warning" },
  BLOCKED: { label: "Blocked", variant: "danger" },
  SKIPPED: { label: "Skipped", variant: "neutral" },
};

export const SEVERITY: Record<ShipmentExceptionSeverity, V> = { INFO: "info", WARNING: "warning", CRITICAL: "danger" };

export const UPDATE_STATUS: Record<BuyerUpdateStatus, { label: string; variant: V }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  APPROVED: { label: "Approved — not sent", variant: "info" },
  RECORDED_SENT: { label: "Recorded as sent (outside ExportPro)", variant: "success" },
  DISCARDED: { label: "Discarded", variant: "neutral" },
};

export const SOURCE_LABEL: Record<TrackingSource, string> = {
  MANUAL: "Manual entry",
  CARRIER_API: "Carrier provider",
  FORWARDER: "Reported by forwarder",
  USER_UPLOAD: "From uploaded document",
  SYSTEM_DERIVED: "Derived by ExportPro",
};

export const FIELD_SOURCE: Record<FieldSourced["source"], string> = {
  PURCHASE_ORDER: "Buyer PO",
  PROFORMA_INVOICE: "Proforma invoice",
  QUOTATION: "Quotation",
  PACKING_LIST: "Packing list",
  SHIPPING_INSTRUCTION: "Shipping instruction",
  FREIGHT_QUOTE: "Freight quote",
  ORGANIZATION: "Organization profile",
  MANUAL: "Entered manually",
  NONE: "Not available",
};

export const label = words;
export const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }) : "—");
export const dateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");
export const money = (amount: string | null | undefined, currency: string | null | undefined) => (amount ? `${currency ?? ""} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : "—");
export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: words(v) }));

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return <Badge variant={SHIPMENT_STATUS[status].variant}>{SHIPMENT_STATUS[status].label}</Badge>;
}
export function HealthBadge({ health }: { health: ShipmentHealth }) {
  return <Badge variant={HEALTH[health].variant}>Health: {HEALTH[health].label}</Badge>;
}

/** One nav item ("Shipments & Logistics") with section tabs. */
export function LogisticsTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/shipments", label: "Shipments", match: (p: string) => p === "/shipments" || (/^\/shipments\/(?!exceptions)/.test(p)) },
    { href: "/freight-quotes", label: "Freight quotes", match: (p: string) => p.startsWith("/freight-quotes") },
    { href: "/shipments/exceptions", label: "Exceptions", match: (p: string) => p.startsWith("/shipments/exceptions") },
  ];
  return (
    <nav aria-label="Logistics sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href}>
              <Button asChild size="sm" variant={active ? "secondary" : "ghost"}>
                <Link href={t.href} aria-current={active ? "page" : undefined}>{t.label}</Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function useCan() {
  const { data: session } = useSession();
  return (p: Permission) => hasPermission(session, p);
}

/** Mutation helper: invalidates logistics queries, toasts and surfaces friendly errors. */
export function useLogisticsMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["logistics"] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409 && /version|changed/i.test(e.message)) {
        toast.error("This shipment changed", "Someone else updated it. The latest version has been loaded.");
        qc.invalidateQueries({ queryKey: ["logistics"] });
      } else toast.error("Action failed", toFriendlyErrorMessage(e));
    },
  });
}

export function CopyButton({ text, label: l = "Copy" }: { text: string; label?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy", "Select the text and copy it manually.");
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={copy}>
      <Copy className="size-4" aria-hidden="true" />
      {l}
    </Button>
  );
}

export function SourceTag({ source }: { source: FieldSourced["source"] }) {
  return <span className="text-xs text-muted-foreground">({FIELD_SOURCE[source]})</span>;
}
