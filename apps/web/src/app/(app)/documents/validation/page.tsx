"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { validationApi } from "@/lib/api/document-validation";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { DOC_TYPE, EXTRACTION_STATUS, VALIDATION_STATUS } from "@/lib/compliance-labels";
import { ComplianceSectionTabs } from "@/components/compliance/shared";
import { MissingDocumentsList } from "@/components/document-validation/missing-documents";
import { VALIDATION_DISCLAIMER } from "@/components/document-validation/validation-run";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const TABS = [
  { key: "needs", label: "Needs validation" },
  { key: "issues", label: "Issues" },
  { key: "missing", label: "Missing documents" },
  { key: "approved", label: "Signed off" },
  { key: "history", label: "History" },
] as const;

export default function ValidationDashboardPage() {
  return (
    <RequirePermission permission="document_validation.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Dashboard />
      </Suspense>
    </RequirePermission>
  );
}

const runHref = (r: { purchaseOrderId: string | null; primaryDocumentId: string | null }) => (r.primaryDocumentId ? `/documents/${r.primaryDocumentId}` : r.purchaseOrderId ? `/documents/validation/orders/${r.purchaseOrderId}` : "/documents/validation");

function Dashboard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (params.get("tab") ?? "needs") as (typeof TABS)[number]["key"];
  const q = useQuery({ queryKey: ["validation", "dashboard"], queryFn: validationApi.dashboard });
  const s = q.data?.summary;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Documents &amp; Compliance</PageTitle>
        <HelperText className="mt-1">{VALIDATION_DISCLAIMER}</HelperText>
      </div>
      <ComplianceSectionTabs />
      {s && (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-6" aria-label="Validation summary">
          {[["Validated docs", s.documentsValidated], ["Open critical", s.critical], ["Open warnings", s.warnings], ["Missing now", s.missing], ["Signed off", s.signedOff]].map(([k, v]) => <li key={k}><Card className="p-3"><Caption>{k}</Caption><p className="text-xl font-semibold">{v}</p></Card></li>)}
          <li><Card className="p-3"><Caption>Last validation</Caption><p className="text-sm font-medium">{s.lastValidationAt ? new Date(s.lastValidationAt).toLocaleDateString() : "—"}</p></Card></li>
        </ul>
      )}
      <div role="tablist" aria-label="Validation views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "secondary" : "ghost"} onClick={() => router.replace(`${pathname}${t.key === "needs" ? "" : `?tab=${t.key}`}`, { scroll: false })}>{t.label}</Button>)}
      </div>
      {q.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : q.isError || !q.data ? (
        <ErrorState title="Could not load validation" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : tab === "needs" ? (
        !q.data.needsValidation.length ? <EmptyState icon={ShieldCheck} title="Nothing waiting for validation" description="Uploaded documents appear here until their data is confirmed and validated." /> : (
          <ul className="flex flex-col gap-2">
            {q.data.needsValidation.map((d) => (
              <li key={d.id}><Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0"><Link className="font-medium text-primary hover:underline" href={`/documents/${d.id}`}>{d.title}{d.version > 1 ? ` v${d.version}` : ""}</Link><Caption className="block">{DOC_TYPE[d.documentType]} · {d.generated ? "structured (ExportPro)" : d.dataSource === "CONFIRMED" ? "confirmed data" : d.dataSource === "UNREVIEWED" ? "extraction awaiting review" : "no data yet — extract or enter manually"}</Caption></div>
                <span className="flex flex-wrap gap-1">{d.extractionStatus && <Badge variant={EXTRACTION_STATUS[d.extractionStatus].variant}>{EXTRACTION_STATUS[d.extractionStatus].label}</Badge>}<Badge variant={VALIDATION_STATUS[d.validationStatus].variant}>{VALIDATION_STATUS[d.validationStatus].label}</Badge></span>
              </Card></li>
            ))}
          </ul>
        )
      ) : tab === "issues" ? (
        !q.data.issues.length ? <EmptyState icon={ShieldCheck} title="No open validation issues" description="No material mismatches detected by the configured validation rules on the latest runs." /> : (
          <ul className="flex flex-col gap-2">{q.data.issues.map((r) => <li key={r.runId}><Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><Link className="font-medium text-primary hover:underline" href={runHref(r)}>{r.label}</Link><span className="flex gap-1">{r.critical > 0 && <Badge variant="danger">{r.critical} critical</Badge>}{r.warning > 0 && <Badge variant="warning">{r.warning} warning{r.warning === 1 ? "" : "s"}</Badge>}</span></Card></li>)}</ul>
        )
      ) : tab === "missing" ? (
        !q.data.missing.length ? <EmptyState icon={ShieldCheck} title="No missing documents" description="For evaluated accepted orders, all expected documents available now are on file." /> : (
          <div className="flex flex-col gap-4">{q.data.missing.map((m) => (
            <Card key={m.purchaseOrderId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle className="text-base">PO {m.poNumber} · {m.buyerName}</SectionTitle><Link className="text-sm text-primary hover:underline" href={`/documents/validation/orders/${m.purchaseOrderId}`}>Open package</Link></div>
              <div className="mt-2"><MissingDocumentsList rows={m.rows} purchaseOrderId={m.purchaseOrderId} /></div>
            </Card>
          ))}</div>
        )
      ) : tab === "approved" ? (
        !q.data.signedOff.length ? <EmptyState icon={ShieldCheck} title="No signed-off validations yet" /> : (
          <ul className="flex flex-col gap-2">{q.data.signedOff.map((r) => <li key={r.runId}><Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><Link className="text-primary hover:underline" href={runHref(r)}>{r.label}</Link><Caption>Signed off {new Date(r.signedOffAt).toLocaleString()}{r.signedOffBy ? ` · ${r.signedOffBy}` : ""}</Caption></Card></li>)}</ul>
        )
      ) : !q.data.history.length ? <EmptyState icon={ShieldCheck} title="No validation runs yet" /> : (
        <ul className="flex flex-col gap-2">{q.data.history.map((r) => <li key={r.runId}><Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><Link className="text-primary hover:underline" href={runHref(r)}>{r.label}</Link><span className="flex flex-wrap items-center gap-1"><Badge variant={VALIDATION_STATUS[r.status].variant}>{VALIDATION_STATUS[r.status].label}</Badge><Caption>{r.critical} critical · {r.warning} warnings · {new Date(r.createdAt).toLocaleString()}</Caption></span></Card></li>)}</ul>
      )}
    </div>
  );
}
