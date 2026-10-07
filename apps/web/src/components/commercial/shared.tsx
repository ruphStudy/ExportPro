"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import type { CommercialEvent, Permission } from "@exportpro/types";
import { COSTING_CURRENCIES, RFQ_INCOTERMS } from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

export const INCOTERM_OPTIONS = RFQ_INCOTERMS.map((t) => ({ value: t, label: t }));
export const CURRENCY_OPTIONS = COSTING_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }));

/** Shared section switcher for the three commercial lists. */
export function CommercialTabs() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const tabs = ([
    { href: "/quotations", label: "Quotations", perm: "quotations.view" },
    { href: "/proforma-invoices", label: "Proforma invoices", perm: "proforma_invoice.view" },
    { href: "/purchase-orders", label: "Buyer POs", perm: "purchase_orders.view" },
  ] as { href: string; label: string; perm: Permission }[]).filter((t) => hasPermission(session, t.perm));
  return (
    <nav aria-label="Commercial documents" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Button asChild size="sm" variant={active ? "secondary" : "ghost"}>
                <Link href={t.href} aria-current={active ? "page" : undefined}>{t.label}</Link>
              </Button>
            </li>
          );
        })}
        {hasPermission(session, "commercial.settings") && (
          <li>
            <Button asChild size="sm" variant={pathname === "/quotations/settings" ? "secondary" : "ghost"}>
              <Link href="/quotations/settings" aria-current={pathname === "/quotations/settings" ? "page" : undefined}>Settings</Link>
            </Button>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Saved buyers (Sprint 6) as picker options; the current buyer is always kept. */
export function useBuyerOptions(current?: { id: string | null; name: string } | null) {
  const q = useQuery({ queryKey: ["buyers", "saved", "picker"], queryFn: () => buyersApi.saved({ pageSize: 100 }), staleTime: 60_000 });
  const opts = (q.data?.items ?? []).map((s) => ({ value: s.buyer.id, label: s.buyer.name }));
  if (current?.id && !opts.some((o) => o.value === current.id)) opts.unshift({ value: current.id, label: current.name });
  return opts;
}

/** Mutation helper: invalidates commercial queries, toasts and surfaces friendly errors. */
export function useCommercialMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["commercial"] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409 && /version|changed/i.test(e.message)) {
        toast.error("This document changed", "Someone else updated it. The latest version has been loaded.");
        qc.invalidateQueries({ queryKey: ["commercial"] });
      } else toast.error("Action failed", toFriendlyErrorMessage(e));
    },
  });
}

/** Dialog that requires a written reason (reject, cancel, revise, override …). */
export function ReasonDialog({ open, onOpenChange, title, description, label = "Reason", confirmLabel, destructive, loading, onConfirm, minLength = 3, children }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  minLength?: number;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = React.useState("");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive={destructive}
      loading={loading}
      confirmDisabled={reason.trim().length < minLength}
      onConfirm={() => onConfirm(reason.trim())}
    >
      {children}
      <Textarea label={label} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} description={`At least ${minLength} characters.`} />
    </ConfirmDialog>
  );
}

const ENTITY_LABEL = { QUOTATION: "Quotation", PI: "Proforma invoice", PO: "Purchase order", DOCUMENT: "Document", COMPLIANCE: "Compliance" } as const;

/** Commercial timeline (business events; separate from the audit log). */
export function CommercialTimeline({ events }: { events: CommercialEvent[] }) {
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Commercial timeline</SectionTitle>
      {!events.length ? (
        <HelperText className="mt-1">No events yet.</HelperText>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5 border-l border-border pl-4">
          {events.map((e) => (
            <li key={e.id} className="relative text-sm">
              <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" aria-hidden="true" />
              <p className="break-words">{e.title}</p>
              <Caption>{ENTITY_LABEL[e.entityType]} · {new Date(e.createdAt).toLocaleString()}{e.actor ? ` · ${e.actor}` : ""}</Caption>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Problems that block issuing, shown as an accessible list. */
export function IssueProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <div role="note" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
      <p className="font-medium">Before issuing, fix:</p>
      <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  );
}

/** Currency + Incoterm selectors used by several editors. */
export function TermsSelects({ currency, incoterm, onCurrency, onIncoterm, disabled }: { currency: string; incoterm: string | null; onCurrency: (v: string) => void; onIncoterm: (v: string | null) => void; disabled?: boolean }) {
  return (
    <>
      <Select label="Currency" value={currency} onChange={(e) => onCurrency(e.target.value)} options={CURRENCY_OPTIONS} disabled={disabled} />
      <Select label="Incoterm" placeholder="Select" value={incoterm ?? ""} onChange={(e) => onIncoterm(e.target.value || null)} options={INCOTERM_OPTIONS} disabled={disabled} />
    </>
  );
}
