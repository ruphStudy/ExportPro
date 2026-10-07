"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { quotationsApi } from "@/lib/api/commercial";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { CURRENCY_OPTIONS, useBuyerOptions } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

const SOURCES = ["inquiryId", "quotationRequestId", "costingId", "costingScenarioId", "crmLeadId", "buyerCompanyId"] as const;
const SOURCE_TEXT: Record<string, string> = {
  quotationRequestId: "the RFQ’s quotation request (confirmed items and terms are prefilled)",
  inquiryId: "the buyer inquiry (confirmed RFQ items are prefilled)",
  costingId: "the export costing (price taken from its preserved snapshot)",
  crmLeadId: "the CRM lead",
  buyerCompanyId: "the buyer",
};

export default function NewQuotationPage() {
  return (
    <RequirePermission permission="quotations.create">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NewQuotation />
      </Suspense>
    </RequirePermission>
  );
}

function NewQuotation() {
  const params = useSearchParams();
  const router = useRouter();
  const ctx = Object.fromEntries(SOURCES.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)) as Record<string, string>;
  const from = SOURCES.find((k) => ctx[k] && SOURCE_TEXT[k]);
  const [buyerCompanyId, setBuyer] = React.useState(ctx.buyerCompanyId ?? "");
  const [buyerName, setBuyerName] = React.useState("");
  const [currency, setCurrency] = React.useState("");
  const [needsAck, setNeedsAck] = React.useState<string | null>(null);
  const [ack, setAck] = React.useState(false);
  const buyers = useBuyerOptions();
  const create = useMutation({
    mutationFn: () =>
      quotationsApi.create({
        ...ctx,
        buyerCompanyId: buyerCompanyId || undefined,
        buyerName: !buyerCompanyId && buyerName.trim() ? buyerName.trim() : undefined,
        currency: currency || undefined,
        acknowledgeDraftCosting: ack || undefined,
      }),
    onSuccess: (q) => {
      toast.success(`Quotation ${q.displayNumber} created`);
      router.replace(`/quotations/${q.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && (e.details as { code?: string } | undefined)?.code === "DRAFT_COSTING") setNeedsAck(e.message);
      else toast.error("Could not create quotation", toFriendlyErrorMessage(e));
    },
  });
  const linked = Boolean(ctx.inquiryId || ctx.quotationRequestId || ctx.costingId || ctx.crmLeadId);
  return (
    <div className="flex min-w-0 max-w-2xl flex-col gap-5">
      <Breadcrumbs items={[{ label: "Quotes & Orders", href: "/quotations" }, { label: "New quotation" }]} />
      <div>
        <PageTitle>New quotation</PageTitle>
        <HelperText className="mt-1">{from ? `Created from ${SOURCE_TEXT[from]}.` : "Manual quotation. You can add items and terms on the next screen."} Nothing is sent to the buyer.</HelperText>
      </div>
      <Card className="flex flex-col gap-4 p-4">
        <Select label="Buyer" placeholder={linked ? "Use the linked record’s buyer" : "Select a saved buyer"} value={buyerCompanyId} onChange={(e) => setBuyer(e.target.value)} options={buyers} description="Saved buyers from Buyer Search." />
        {!buyerCompanyId && !linked && <Input label="Or buyer name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} maxLength={160} />}
        <Select label="Currency" placeholder={linked ? "From the linked costing / RFQ" : "USD"} value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCY_OPTIONS} description="Costing prices are only applied when the costing’s quote currency matches." />
        {needsAck && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />{needsAck}</p>
            <Checkbox label="I understand this costing is still a draft and its price may change" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={Boolean(needsAck) && !ack}>Create draft quotation</Button>
        </div>
      </Card>
    </div>
  );
}
