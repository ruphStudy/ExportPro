"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission, ProfitabilityStatus, ReceivableStatus, RepeatSignalLevel } from "@exportpro/types";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type V = "neutral" | "success" | "warning" | "danger" | "info";

export const RECEIVABLE_STATUS: Record<ReceivableStatus, { label: string; variant: V }> = {
  NOT_DUE: { label: "Not due", variant: "neutral" },
  DUE_SOON: { label: "Due soon", variant: "info" },
  DUE: { label: "Due today", variant: "warning" },
  PARTIALLY_PAID: { label: "Partially paid", variant: "info" },
  PAID: { label: "Paid", variant: "success" },
  OVERDUE: { label: "Overdue", variant: "danger" },
  DISPUTED: { label: "Disputed", variant: "warning" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
  UNCOLLECTIBLE: { label: "Marked uncollectible", variant: "neutral" },
};

export const PROFIT_STATUS: Record<ProfitabilityStatus, { label: string; variant: V; hint: string }> = {
  INCOMPLETE: { label: "Incomplete", variant: "warning", hint: "Required actual costs or revenue are missing — not a final profit." },
  ESTIMATED: { label: "Estimate only", variant: "neutral", hint: "Only the Sprint 14 costing estimate exists." },
  ACTUAL_IN_PROGRESS: { label: "Actuals complete — not finalized", variant: "info", hint: "Ready to finalize; figures can still change." },
  FINALIZED: { label: "Finalized", variant: "success", hint: "Immutable snapshot." },
};

export const SIGNAL: Record<RepeatSignalLevel, { label: string; variant: V }> = {
  HIGH: { label: "High repeat signal", variant: "success" },
  MEDIUM: { label: "Medium repeat signal", variant: "info" },
  LOW: { label: "Low repeat signal", variant: "neutral" },
  INSUFFICIENT_DATA: { label: "Insufficient history", variant: "neutral" },
};

export const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: words(v) }));
export const day = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString(undefined, { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }) : "—");
export const money = (amount: string | null | undefined, currency?: string | null) => (amount === null || amount === undefined ? "—" : `${currency ? `${currency} ` : ""}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pct = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`);
export const todayIso = () => new Date().toISOString().slice(0, 10);

export function ReceivableBadge({ status }: { status: ReceivableStatus }) {
  return <Badge variant={RECEIVABLE_STATUS[status].variant}>{RECEIVABLE_STATUS[status].label}</Badge>;
}
export function ProfitBadge({ status }: { status: ProfitabilityStatus }) {
  return <Badge variant={PROFIT_STATUS[status].variant} title={PROFIT_STATUS[status].hint}>{PROFIT_STATUS[status].label}</Badge>;
}
export function SignalBadge({ level }: { level: RepeatSignalLevel }) {
  return <Badge variant={SIGNAL[level].variant}>{SIGNAL[level].label}</Badge>;
}

export function useCan() {
  const { data: session } = useSession();
  return (p: Permission) => hasPermission(session, p);
}

/** Overview / Receivables / Payments / Profitability / Repeat business. */
export function FinanceTabs() {
  const pathname = usePathname();
  const can = useCan();
  const tabs = [
    { href: "/finance", label: "Overview", on: pathname === "/finance", perm: "finance.view" as Permission },
    { href: "/finance/receivables", label: "Receivables", on: pathname.startsWith("/finance/receivables"), perm: "finance.view" as Permission },
    { href: "/finance/payments", label: "Payments", on: pathname.startsWith("/finance/payments"), perm: "finance.view" as Permission },
    { href: "/profitability", label: "Profitability", on: pathname.startsWith("/profitability"), perm: "profitability.view" as Permission },
    { href: "/repeat-business", label: "Repeat business", on: pathname.startsWith("/repeat-business"), perm: "repeat_business.view" as Permission },
  ].filter((t) => can(t.perm));
  return (
    <nav aria-label="Finance sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <li key={t.href}>
            <Button asChild size="sm" variant={t.on ? "secondary" : "ghost"}>
              <Link href={t.href} aria-current={t.on ? "page" : undefined}>{t.label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const RANGES = [
  { value: "month", label: "Current month" },
  { value: "30d", label: "Last 30 days" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

export function RangePicker({ range, from, to, onChange }: { range: string; from: string; to: string; onChange: (k: "range" | "from" | "to", v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select aria-label="Date range" containerClassName="w-44" value={range} onChange={(e) => onChange("range", e.target.value)} options={RANGES} />
      {range === "custom" && (
        <>
          <Input type="date" aria-label="From" containerClassName="w-40" value={from} onChange={(e) => onChange("from", e.target.value)} />
          <Input type="date" aria-label="To" containerClassName="w-40" value={to} onChange={(e) => onChange("to", e.target.value)} />
        </>
      )}
    </div>
  );
}

/** Invalidates finance queries, toasts, and surfaces friendly errors (incl. version conflicts). */
export function useFinanceMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409 && /changed by someone/i.test(e.message)) {
        toast.error("This record changed", "Someone else updated it. The latest version has been loaded.");
        qc.invalidateQueries({ queryKey: ["finance"] });
      } else toast.error("Action failed", toFriendlyErrorMessage(e));
    },
  });
}

export const NOT_ACCOUNTING = "Operational finance tracking — not an accounting ledger, tax filing, payment gateway or bank integration.";
