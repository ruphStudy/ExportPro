"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CertificationVerification, PayableStatus, Permission, ProcurementStatus, QualityStatus, SupplierPoStatus, SupplierProvenance, SupplierRfqStatus } from "@exportpro/types";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { useCan, words } from "@/components/finance/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export { day, money, useCan, words, todayIso } from "@/components/finance/shared";

type V = "neutral" | "success" | "warning" | "danger" | "info";

export const NOT_ACCOUNTING_PROC = "Operational procurement tracking — not a purchase ledger, GST filing, payment gateway or bank integration.";

const RFQ_V: Record<SupplierRfqStatus, V> = { DRAFT: "neutral", READY: "info", REQUESTED: "info", PARTIALLY_QUOTED: "warning", QUOTED: "success", CLOSED: "neutral", CANCELLED: "neutral" };
const PO_V: Record<SupplierPoStatus, V> = { DRAFT: "neutral", ISSUED: "info", ACKNOWLEDGED: "info", IN_PRODUCTION: "info", READY: "info", PARTIALLY_RECEIVED: "warning", RECEIVED: "success", COMPLETED: "success", CANCELLED: "neutral" };
const Q_V: Record<QualityStatus | "NONE", V> = { NONE: "neutral", PENDING: "warning", PASSED: "success", FAILED: "danger", PARTIAL: "warning", HOLD: "danger", WAIVED: "info" };
const PAY_V: Record<PayableStatus, V> = { NOT_DUE: "neutral", DUE_SOON: "info", DUE: "warning", PARTIALLY_PAID: "info", PAID: "success", OVERDUE: "danger", DISPUTED: "warning", CANCELLED: "neutral" } as Record<PayableStatus, V>;
const CERT_V: Record<CertificationVerification, V> = { NOT_PROVIDED: "neutral", UPLOADED: "warning", USER_CONFIRMED: "info", DOCUMENT_REVIEWED: "info", EXTERNAL_VERIFIED: "success" };

export const RfqBadge = ({ status }: { status: SupplierRfqStatus }) => <Badge variant={RFQ_V[status]}>{words(status)}</Badge>;
export const PoBadge = ({ status }: { status: SupplierPoStatus }) => <Badge variant={PO_V[status]}>{words(status)}</Badge>;
export const ProcBadge = ({ status }: { status: ProcurementStatus }) => <Badge variant={status === "QUALITY_HOLD" ? "danger" : status === "RECEIVED" || status === "CLOSED" ? "success" : "neutral"}>{words(status)}</Badge>;
export const QualityBadge = ({ status }: { status: QualityStatus | "NONE" }) => <Badge variant={Q_V[status]}>{status === "NONE" ? "No receipt" : `Quality: ${words(status).toLowerCase()}`}</Badge>;
export const PayBadge = ({ status }: { status: PayableStatus }) => <Badge variant={PAY_V[status] ?? "neutral"}>{words(status)}</Badge>;
export const CertBadge = ({ v }: { v: CertificationVerification }) => <Badge variant={CERT_V[v]} title={v === "UPLOADED" ? "A document was uploaded — it has not been authenticated." : undefined}>{v === "UPLOADED" ? "Uploaded (not verified)" : words(v)}</Badge>;

/** Source + verification are always visible: suppliers are never presented as verified unless they are. */
export function ProvenanceBadges({ p }: { p: SupplierProvenance }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant="neutral" title={`Source: ${p.sourceLabel}`}>{p.sourceLabel || words(p.source)}</Badge>
      <Badge variant={p.verification === "UNVERIFIED" ? "warning" : "info"}>{words(p.verification)}</Badge>
      {p.demo && <Badge variant="warning">Demo data</Badge>}
    </span>
  );
}

/** Overview / Suppliers / RFQs / Supplier POs / Goods receipt / Payables. */
export function ProcurementTabs() {
  const pathname = usePathname();
  const can = useCan();
  const tabs = [
    { href: "/procurement", label: "Overview", on: pathname === "/procurement", perm: "procurement.view" as Permission },
    { href: "/procurement/suppliers", label: "Suppliers", on: pathname.startsWith("/procurement/suppliers"), perm: "suppliers.view" as Permission },
    { href: "/procurement/rfqs", label: "RFQs", on: pathname.startsWith("/procurement/rfqs"), perm: "supplier_rfq.view" as Permission },
    { href: "/procurement/orders", label: "Supplier POs", on: pathname.startsWith("/procurement/orders"), perm: "procurement.view" as Permission },
    { href: "/procurement/receipts", label: "Goods receipt", on: pathname.startsWith("/procurement/receipts"), perm: "procurement.view" as Permission },
    { href: "/procurement/payables", label: "Payables", on: pathname.startsWith("/procurement/payables"), perm: "supplier_payments.view" as Permission },
  ].filter((t) => can(t.perm));
  return (
    <nav aria-label="Procurement sections" className="-mx-1 overflow-x-auto">
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

/** Invalidates procurement (and dependent finance/shipment) queries, toasts, handles version conflicts. */
export function useProcMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      for (const k of ["procurement", "finance", "shipments", "costing"]) qc.invalidateQueries({ queryKey: [k] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409 && /changed by someone/i.test(e.message)) {
        toast.error("This record changed", "Someone else updated it. The latest version has been loaded.");
        qc.invalidateQueries({ queryKey: ["procurement"] });
      } else toast.error("Action failed", toFriendlyErrorMessage(e));
    },
  });
}

/** “Find suppliers” entry point used from opportunity, product, buyer RFQ and buyer PO pages. */
export function FindSuppliersButton({ product, productId, buyerPurchaseOrderId, opportunityId, size = "sm" }: { product?: string | null; productId?: string | null; buyerPurchaseOrderId?: string | null; opportunityId?: string | null; size?: "sm" | "md" }) {
  const can = useCan();
  if (!can("suppliers.view")) return null;
  const p = new URLSearchParams();
  if (product) p.set("product", product);
  if (productId) p.set("productId", productId);
  if (buyerPurchaseOrderId) p.set("buyerPurchaseOrderId", buyerPurchaseOrderId);
  if (opportunityId) p.set("opportunityId", opportunityId);
  return (
    <Button asChild size={size} variant="secondary">
      <Link href={`/procurement/suppliers${p.toString() ? `?${p}` : ""}`}>Find suppliers</Link>
    </Button>
  );
}
