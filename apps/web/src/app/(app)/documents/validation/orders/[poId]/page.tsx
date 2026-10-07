"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { validationApi } from "@/lib/api/document-validation";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { DOC_TYPE, EXTRACTION_STATUS, VALIDATION_STATUS } from "@/lib/compliance-labels";
import { MissingDocumentsList } from "@/components/document-validation/missing-documents";
import { useValidationMutation, VALIDATION_DISCLAIMER, ValidationRunCard } from "@/components/document-validation/validation-run";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function OrderValidationPage() {
  return (
    <RequirePermission permission="document_validation.view">
      <OrderValidation />
    </RequirePermission>
  );
}

function OrderValidation() {
  const { poId } = useParams<{ poId: string }>();
  const q = useQuery({ queryKey: ["validation", "package", poId], queryFn: () => validationApi.packageView(poId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  const [runId, setRunId] = React.useState<string | null>(null);
  const run = useQuery({ queryKey: ["validation", "run", runId], queryFn: () => validationApi.run(runId!), enabled: Boolean(runId) });
  const rerun = useValidationMutation(() => validationApi.runPackage(poId), "Package validated", () => setRunId(null));
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Validation package not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const p = q.data;
  const c = p.completeness;
  const shown = runId && run.data ? run.data : p.latestRun;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Document validation", href: "/documents/validation" }, { label: `PO ${p.purchaseOrder.poNumber}` }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">Transaction document package</Caption>
          <PageTitle className="break-words">PO {p.purchaseOrder.poNumber} · {p.purchaseOrder.buyerName}</PageTitle>
          <div className="mt-1 flex flex-wrap gap-2"><Badge variant={VALIDATION_STATUS[p.status].variant}>{VALIDATION_STATUS[p.status].label}</Badge><Link className="text-sm text-primary hover:underline" href={`/purchase-orders/${p.purchaseOrder.id}`}>Open PO</Link><Link className="text-sm text-primary hover:underline" href={`/compliance/orders/${p.purchaseOrder.id}`}>Compliance checklist</Link></div>
        </div>
        {p.availableActions.includes("run") && <Button onClick={() => rerun.mutate(undefined)} loading={rerun.isPending}>{p.latestRun ? "Run validation again" : "Validate package"}</Button>}
      </header>
      <HelperText>{VALIDATION_DISCLAIMER}</HelperText>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Completeness">
        <li><Card className="p-3"><Caption>Required now</Caption><p className="text-xl font-semibold">{c.availableNow}/{c.requiredNow}</p></Card></li>
        <li><Card className="p-3"><Caption>Expected later</Caption><p className="text-xl font-semibold">{c.expectedLater}</p></Card></li>
        <li><Card className="p-3"><Caption>Unknown</Caption><p className="text-xl font-semibold">{c.unknown}</p></Card></li>
        <li><Card className="p-3"><Caption>Warnings</Caption><p className="text-xl font-semibold">{c.warnings}</p></Card></li>
        <li><Card className="p-3"><Caption>Open validation issues</Caption><p className="text-xl font-semibold">{c.validationIssues}</p></Card></li>
      </ul>
      {p.sprint15OpenDiscrepancies > 0 && <p role="note" className="text-sm">The buyer PO also has {p.sprint15OpenDiscrepancies} open PO comparison discrepanc{p.sprint15OpenDiscrepancies === 1 ? "y" : "ies"} (Quotation/PI vs PO). <Link className="text-primary hover:underline" href={`/purchase-orders/${p.purchaseOrder.id}`}>Review on the PO</Link></p>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {shown ? <ValidationRunCard run={shown} onRerun={() => rerun.mutate(undefined)} rerunning={rerun.isPending} history={p.history.map((h) => ({ id: h.id, runNumber: h.runNumber, status: h.status, createdAt: h.createdAt }))} onSelect={(id) => setRunId(id === p.latestRun?.id ? null : id)} /> : run.isLoading ? <Skeleton className="h-40 w-full" /> : <Card className="p-4"><HelperText>Not validated yet. Confirm extracted data of uploaded documents, then validate the package.</HelperText></Card>}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Documents">
          <Card className="p-4">
            <SectionTitle className="text-base">Documents in this order</SectionTitle>
            {!p.documents.length ? <HelperText className="mt-1">No documents yet.</HelperText> : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {p.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="min-w-0 truncate text-primary hover:underline" href={`/documents/${d.id}`}>{d.title}{d.version > 1 ? ` v${d.version}` : ""}</Link>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="neutral">{d.dataSource === "STRUCTURED" ? "Structured" : d.dataSource === "CONFIRMED" ? "Confirmed" : d.dataSource === "UNREVIEWED" ? "Unreviewed" : "No data"}</Badge>
                      {d.extractionStatus && <Badge variant={EXTRACTION_STATUS[d.extractionStatus].variant}>{EXTRACTION_STATUS[d.extractionStatus].label}</Badge>}
                      <Badge variant={VALIDATION_STATUS[d.validationStatus].variant}>{VALIDATION_STATUS[d.validationStatus].label}</Badge>
                    </span>
                    <Caption className="w-full">{DOC_TYPE[d.documentType]}{d.openIssues ? ` · ${d.openIssues} open issue${d.openIssues === 1 ? "" : "s"}` : ""}</Caption>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <SectionTitle className="text-base">Expected documents</SectionTitle>
            {!p.checklistId ? <HelperText className="mt-1">Evaluate the compliance checklist to know which documents are expected. <Link className="text-primary hover:underline" href={`/compliance/orders/${p.purchaseOrder.id}`}>Open compliance</Link></HelperText> : <div className="mt-2"><MissingDocumentsList rows={p.missing} purchaseOrderId={p.purchaseOrder.id} /></div>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
