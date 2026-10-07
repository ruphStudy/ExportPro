"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { GeneratedDocumentType, TradeDocumentSummary } from "@exportpro/types";
import { DOCUMENT_SOURCES, DOCUMENT_STATUSES, TRADE_DOCUMENT_TYPES } from "@exportpro/types";
import { poApi } from "@/lib/api/commercial";
import { documentsApi, type DocumentListQuery } from "@/lib/api/compliance";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { DOC_STATUS, DOC_TYPE, EXPIRY, SOURCE } from "@/lib/compliance-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { ComplianceSectionTabs } from "@/components/compliance/shared";
import { UploadDocumentDialog } from "@/components/compliance/upload-dialog";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const KEYS = ["tab", "search", "documentType", "status", "source", "purchaseOrderId", "buyerCompanyId", "expiry", "createdBy", "page"] as const;
const TABS = [
  { key: "all", label: "All documents" },
  { key: "commercial", label: "Commercial" },
  { key: "compliance", label: "Compliance" },
  { key: "shipment", label: "Shipment preparation" },
  { key: "external", label: "External / uploaded" },
  { key: "expiring", label: "Expiring" },
];

export default function DocumentsPage() {
  return (
    <RequirePermission permission="documents.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Documents />
      </Suspense>
    </RequirePermission>
  );
}

function Documents() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const query = React.useMemo(() => {
    const q: Record<string, string | number> = {};
    for (const k of KEYS) {
      const v = params.get(k);
      if (v) q[k] = k === "page" ? Number(v) : v;
    }
    return q as DocumentListQuery;
  }, [params]);
  const update = (patch: Partial<DocumentListQuery>) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) delete next.page;
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== "") s.set(k, String(v));
    router.replace(`${pathname}${s.toString() ? `?${s}` : ""}`, { scroll: false });
  };
  const [upload, setUpload] = React.useState(false);
  const [generate, setGenerate] = React.useState(params.get("generate") === "1");
  const list = useQuery({ queryKey: ["documents", "list", query], queryFn: () => documentsApi.list({ ...query, pageSize: 20 }), placeholderData: keepPreviousData });
  const canGenerate = hasPermission(session, "documents.generate") || hasPermission(session, "documents.edit_logistics");
  const canUpload = hasPermission(session, "documents.upload");
  const tab = query.tab ?? "all";
  const c = list.data?.counts;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>Documents &amp; Compliance</PageTitle>
          <HelperText className="mt-1">ExportPro prepares exporter documents (commercial invoice, packing list, shipping instruction). Official, carrier and bank documents are uploaded or referenced — never generated.</HelperText>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpload && <Button variant="outline" onClick={() => setUpload(true)}><Upload className="size-4" aria-hidden="true" />Upload document</Button>}
          {canGenerate && <Button onClick={() => setGenerate(true)}><FilePlus2 className="size-4" aria-hidden="true" />Prepare document</Button>}
        </div>
      </div>
      <ComplianceSectionTabs />
      <div role="tablist" aria-label="Document views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "secondary" : "ghost"} onClick={() => update({ tab: t.key === "all" ? undefined : t.key })}>
            {t.label}{t.key === "expiring" && c ? ` (${c.expiring})` : ""}
          </Button>
        ))}
      </div>
      {c && (c.expired > 0 || c.underReview > 0) && (
        <p className="flex flex-wrap gap-3 text-sm">
          {c.expired > 0 && <button type="button" className="text-danger hover:underline" onClick={() => update({ expiry: "EXPIRED", tab: undefined })}>{c.expired} expired document{c.expired === 1 ? "" : "s"}</button>}
          {c.underReview > 0 && <button type="button" className="text-primary hover:underline" onClick={() => update({ status: "UNDER_REVIEW" })}>{c.underReview} awaiting review</button>}
        </p>
      )}
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Document filters">
        <Input label="Search" placeholder="Number, buyer, PO, issuer, type…" defaultValue={query.search ?? ""} key={`s-${query.search ?? ""}`} onBlur={(e) => e.target.value !== (query.search ?? "") && update({ search: e.target.value || undefined })} onKeyDown={(e) => e.key === "Enter" && update({ search: e.currentTarget.value || undefined })} containerClassName="lg:col-span-2" />
        <Select label="Type" placeholder="Any" value={query.documentType ?? ""} onChange={(e) => update({ documentType: e.target.value || undefined })} options={TRADE_DOCUMENT_TYPES.map((t) => ({ value: t, label: DOC_TYPE[t] }))} />
        <Select label="Status" placeholder="Current" value={query.status ?? ""} onChange={(e) => update({ status: e.target.value || undefined })} options={DOCUMENT_STATUSES.map((s) => ({ value: s, label: DOC_STATUS[s].label }))} />
        <Select label="Source" placeholder="Any" value={query.source ?? ""} onChange={(e) => update({ source: e.target.value || undefined })} options={DOCUMENT_SOURCES.map((s) => ({ value: s, label: SOURCE[s].label }))} />
        <Select label="Expiry" placeholder="Any" value={query.expiry ?? ""} onChange={(e) => update({ expiry: e.target.value || undefined })} options={[{ value: "EXPIRING_SOON", label: "Expiring soon" }, { value: "EXPIRED", label: "Expired" }, { value: "VALID", label: "Valid / no expiry" }]} />
      </form>
      {(query.purchaseOrderId || query.buyerCompanyId) && <p className="text-sm text-muted-foreground">Filtered by {query.purchaseOrderId ? "purchase order" : "buyer"}. <button type="button" className="text-primary hover:underline" onClick={() => update({ purchaseOrderId: undefined, buyerCompanyId: undefined })}>Clear</button></p>}
      <p className="sr-only" aria-live="polite">{list.data ? `${list.data.meta.totalItems} documents` : ""}</p>
      {list.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : list.isError ? (
        <ErrorState title="Could not load documents" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={FileText} title={tab === "all" && !query.search ? "No trade documents yet" : "No documents match this view"} description="Prepare a commercial invoice from an accepted buyer PO, or upload certificates and official documents." action={canGenerate ? <Button size="sm" onClick={() => setGenerate(true)}>Prepare document</Button> : undefined} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Trade documents</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>{["Document", "Type", "Source", "Order / buyer", "Expiry", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>{list.data.items.map((d) => <Row key={d.id} d={d} />)}</tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Trade documents">
            {list.data.items.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-col gap-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/documents/${d.id}`} className="min-w-0 break-words text-sm font-medium text-primary hover:underline">{d.title}{d.version > 1 ? ` v${d.version}` : ""}</Link>
                    <Badge variant={DOC_STATUS[d.status].variant}>{DOC_STATUS[d.status].label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5"><Badge variant={SOURCE[d.source].variant}>{SOURCE[d.source].label}</Badge>{d.expiry && d.expiry !== "VALID" && <Badge variant={EXPIRY[d.expiry].variant}>{EXPIRY[d.expiry].label}</Badge>}</div>
                  <Caption>{DOC_TYPE[d.documentType]}{d.purchaseOrder ? ` · PO ${d.purchaseOrder.poNumber}` : ""}{d.buyer ? ` · ${d.buyer.name}` : ""}</Caption>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {list.data && list.data.meta.totalPages > 1 && <Pagination meta={list.data.meta} onPageChange={(p) => update({ page: p })} />}
      {upload && <UploadDocumentDialog open onClose={() => setUpload(false)} defaults={{ purchaseOrderId: query.purchaseOrderId }} />}
      {generate && <GenerateDialog onClose={() => setGenerate(false)} purchaseOrderId={params.get("purchaseOrderId") ?? ""} documentType={(params.get("documentType") as GeneratedDocumentType | null) ?? undefined} />}
    </div>
  );
}

function Row({ d }: { d: TradeDocumentSummary }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="max-w-[16rem] px-3 py-2">
        <Link href={`/documents/${d.id}`} className="block truncate font-medium text-primary hover:underline">{d.title}{d.version > 1 ? ` v${d.version}` : ""}</Link>
        <Caption className="block truncate">{[d.documentNumber, d.issuer].filter(Boolean).join(" · ") || "—"}</Caption>
      </td>
      <td className="px-3 py-2">{DOC_TYPE[d.documentType]}</td>
      <td className="px-3 py-2"><Badge variant={SOURCE[d.source].variant}>{SOURCE[d.source].label}</Badge></td>
      <td className="max-w-[12rem] px-3 py-2">{d.purchaseOrder ? <Link className="text-primary hover:underline" href={`/purchase-orders/${d.purchaseOrder.id}`}>PO {d.purchaseOrder.poNumber}</Link> : "—"}<Caption className="block truncate">{d.buyer?.name ?? ""}</Caption></td>
      <td className="whitespace-nowrap px-3 py-2">{d.expiryDate ?? "—"}{d.expiry && d.expiry !== "VALID" && <Badge className="ml-1" variant={EXPIRY[d.expiry].variant}>{EXPIRY[d.expiry].label}</Badge>}</td>
      <td className="px-3 py-2"><Badge variant={DOC_STATUS[d.status].variant}>{DOC_STATUS[d.status].label}</Badge></td>
    </tr>
  );
}

/** Prepare an exporter document from a buyer PO. Official certificates and transport documents cannot be generated here. */
function GenerateDialog({ onClose, purchaseOrderId, documentType }: { onClose: () => void; purchaseOrderId: string; documentType?: GeneratedDocumentType }) {
  const router = useRouter();
  const { data: session } = useSession();
  const canCi = hasPermission(session, "documents.generate");
  const [type, setType] = React.useState<GeneratedDocumentType>(documentType ?? (canCi ? "COMMERCIAL_INVOICE" : "PACKING_LIST"));
  const [po, setPo] = React.useState(purchaseOrderId);
  const [override, setOverride] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const pos = useQuery({ queryKey: ["commercial", "pos", "list", { forDocs: true }], queryFn: () => poApi.list({ pageSize: 50 }) });
  const options = (pos.data?.items ?? []).filter((p) => (type === "COMMERCIAL_INVOICE" ? p.status === "ACCEPTED" : !["CANCELLED", "REJECTED"].includes(p.status)));
  const gen = useMutation({
    mutationFn: () => documentsApi.generate({ documentType: type, purchaseOrderId: po, overrideReason: override !== null ? reason.trim() : undefined }),
    onSuccess: (d) => {
      toast.success(`${d.title} prepared`, "Review the prefilled data before sending it for approval.");
      router.push(`/documents/${d.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && (e.details as { code?: string } | undefined)?.code === "CRITICAL_DISCREPANCIES") setOverride(e.message);
      else toast.error("Could not prepare document", toFriendlyErrorMessage(e));
    },
  });
  const canOverride = hasPermission(session, "documents.approve");
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title="Prepare exporter document" description="Prefilled from the accepted buyer PO and its PI/quotation lineage. Nothing is invented — missing data stays blank for you to complete." confirmLabel={override !== null ? "Prepare with override" : "Prepare draft"} confirmDisabled={!po || (override !== null && (!canOverride || reason.trim().length < 3))} loading={gen.isPending} onConfirm={() => gen.mutate()}>
      <div className="flex flex-col gap-3">
        <Select label="Document" value={type} onChange={(e) => { setType(e.target.value as GeneratedDocumentType); setOverride(null); }} options={[...(canCi ? [{ value: "COMMERCIAL_INVOICE", label: "Commercial invoice (not a GST tax invoice)" }] : []), { value: "PACKING_LIST", label: "Packing list" }, { value: "SHIPPING_INSTRUCTION", label: "Shipping instruction (not a bill of lading)" }]} />
        <Select label="Buyer purchase order" placeholder={pos.isLoading ? "Loading…" : "Select"} value={po} onChange={(e) => { setPo(e.target.value); setOverride(null); }} options={options.map((p) => ({ value: p.id, label: `PO ${p.poNumber} · ${p.buyer.name} · ${p.status.toLowerCase()}` })).concat(po && !options.some((p) => p.id === po) ? [{ value: po, label: "Selected PO" }] : [])} description={type === "COMMERCIAL_INVOICE" ? "Only accepted POs can be invoiced." : undefined} />
        {override !== null && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
            <p>{override}</p>
            {canOverride ? <Textarea label="Manager override reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /> : <p>Ask a manager to resolve the discrepancies or override.</p>}
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
