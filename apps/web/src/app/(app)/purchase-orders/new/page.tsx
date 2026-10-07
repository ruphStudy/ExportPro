"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { piApi, poApi, quotationsApi } from "@/lib/api/commercial";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { emptyPo, poBody, PoFields, poPrefillFromQuotation, type PoFormState } from "@/components/commercial/po-form";
import { useBuyerOptions } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle } from "@/components/ui/typography";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml";

export default function NewPoPage() {
  return (
    <RequirePermission permission="purchase_orders.create">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NewPo />
      </Suspense>
    </RequirePermission>
  );
}

function NewPo() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = React.useState<"manual" | "upload">("manual");
  const [buyerCompanyId, setBuyer] = React.useState(params.get("buyerCompanyId") ?? "");
  const [quotationId, setQuotation] = React.useState(params.get("quotationId") ?? "");
  const [piId, setPi] = React.useState(params.get("proformaInvoiceId") ?? "");
  const [f, setF] = React.useState<PoFormState>(emptyPo);
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState(0);
  const buyers = useBuyerOptions();
  const quotes = useQuery({ queryKey: ["commercial", "quotations", "list", { buyerCompanyId, po: true }], queryFn: () => quotationsApi.list({ buyerCompanyId, pageSize: 50 }), enabled: Boolean(buyerCompanyId) });
  const pis = useQuery({ queryKey: ["commercial", "pis", "list", { buyerCompanyId, po: true }], queryFn: () => piApi.list({ buyerCompanyId, pageSize: 50 }), enabled: Boolean(buyerCompanyId) });
  const quote = useQuery({ queryKey: ["commercial", "quotation", quotationId], queryFn: () => quotationsApi.get(quotationId), enabled: Boolean(quotationId) });

  const create = useMutation({
    mutationFn: () => {
      const links = { quotationId: quotationId || undefined, proformaInvoiceId: piId || undefined };
      return mode === "upload"
        ? poApi.upload(file!, { buyerCompanyId, poNumber: f.poNumber.trim(), poDate: f.poDate, currency: f.currency, ...links }, setProgress)
        : poApi.create({ buyerCompanyId, ...links, ...poBody(f) });
    },
    onSuccess: (po) => {
      toast.success(`PO ${po.poNumber} recorded`, mode === "upload" ? "Now enter the PO items from the document." : "Comparison has run.");
      router.replace(`/purchase-orders/${po.id}`);
    },
    onError: (e) => {
      const existing = e instanceof ApiRequestError ? (e.details as { existingPurchaseOrderId?: string } | undefined)?.existingPurchaseOrderId : undefined;
      if (existing) {
        toast.info("This PO is already recorded", "Opening it.");
        router.push(`/purchase-orders/${existing}`);
      } else toast.error("Could not record PO", toFriendlyErrorMessage(e));
    },
  });
  const ready = buyerCompanyId && f.poNumber.trim() && f.poDate && (mode === "manual" || file);

  return (
    <div className="flex min-w-0 max-w-4xl flex-col gap-5">
      <Breadcrumbs items={[{ label: "Buyer POs", href: "/purchase-orders" }, { label: "Record PO" }]} />
      <div>
        <PageTitle>Record buyer purchase order</PageTitle>
        <HelperText className="mt-1">Enter the PO as the buyer wrote it, or upload the document and enter its lines. Documents are not read automatically.</HelperText>
      </div>
      <div role="tablist" aria-label="Entry method" className="flex gap-1">
        <Button role="tab" aria-selected={mode === "manual"} size="sm" variant={mode === "manual" ? "secondary" : "ghost"} onClick={() => setMode("manual")}>Manual entry</Button>
        <Button role="tab" aria-selected={mode === "upload"} size="sm" variant={mode === "upload" ? "secondary" : "ghost"} onClick={() => setMode("upload")}>Upload PO document</Button>
      </div>
      <Card className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Buyer" required placeholder="Select a buyer" value={buyerCompanyId} onChange={(e) => { setBuyer(e.target.value); setQuotation(""); setPi(""); }} options={buyers} />
          <Select label="Against quotation" placeholder="Not linked" value={quotationId} onChange={(e) => setQuotation(e.target.value)} disabled={!buyerCompanyId} options={(quotes.data?.items ?? []).filter((q) => q.status !== "DRAFT").map((q) => ({ value: q.id, label: `${q.displayNumber} · ${q.status.toLowerCase()}` })).concat(quotationId && !quotes.data?.items.some((q) => q.id === quotationId) ? [{ value: quotationId, label: quote.data?.displayNumber ?? "Linked quotation" }] : [])} />
          <Select label="Against proforma invoice" placeholder="Not linked" value={piId} onChange={(e) => setPi(e.target.value)} disabled={!buyerCompanyId} options={(pis.data?.items ?? []).filter((p) => p.status !== "DRAFT").map((p) => ({ value: p.id, label: `${p.displayNumber} · ${p.status.toLowerCase()}` })).concat(piId && !pis.data?.items.some((p) => p.id === piId) ? [{ value: piId, label: "Linked proforma invoice" }] : [])} />
        </div>
        {mode === "manual" && quote.data && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setF((s) => poPrefillFromQuotation(s, quote.data!))}>Start from {quote.data.displayNumber}</Button>
            <Caption>Prefills lines and terms — then change anything that differs on the buyer’s PO.</Caption>
          </div>
        )}
      </Card>
      <PoFields f={f} onChange={setF} headerOnly={mode === "upload"} />
      {mode === "upload" && (
        <Card className="flex flex-col gap-2 p-4">
          <label htmlFor="po-file" className="text-sm font-medium">PO document</label>
          <input id="po-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <Caption>PDF, image, Word, Excel, CSV or text. Stored privately; only your organization can download it.</Caption>
          {create.isPending && <Progress value={progress} aria-label="Upload progress" />}
        </Card>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>{mode === "upload" ? "Upload and record" : "Record PO"}</Button>
      </div>
    </div>
  );
}
