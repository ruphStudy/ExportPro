"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { DocumentTemplateView } from "@exportpro/types";
import { documentsApi } from "@/lib/api/compliance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ComplianceSectionTabs, useComplianceMutation } from "@/components/compliance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const TITLES: Record<string, string> = { COMMERCIAL_INVOICE: "Commercial invoice", PACKING_LIST: "Packing list", SHIPPING_INSTRUCTION: "Shipping instruction", GENERAL: "General" };

export default function DocumentTemplatesPage() {
  return (
    <RequirePermission permission="documents.approve">
      <Templates />
    </RequirePermission>
  );
}

function Templates() {
  const q = useQuery({ queryKey: ["documents", "templates"], queryFn: documentsApi.templates });
  return (
    <div className="flex min-w-0 max-w-4xl flex-col gap-5">
      <div>
        <PageTitle>Documents &amp; Compliance</PageTitle>
        <HelperText className="mt-1">Plain-text template fields for exporter-prepared documents (no HTML). Approved documents keep the template they were approved with. Branding uses your organization profile and logo.</HelperText>
      </div>
      <ComplianceSectionTabs />
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState title="Could not load templates" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data.map((t) => <TemplateCard key={`${t.documentType}-${JSON.stringify(t)}`} t={t} />)}
    </div>
  );
}

function TemplateCard({ t }: { t: DocumentTemplateView }) {
  const [f, setF] = React.useState({ footer: t.footer ?? "", terms: t.terms ?? "", declaration: t.declaration ?? "", signatureLabel: t.signatureLabel ?? "", expiryWarningDays: String(t.expiryWarningDays) });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const general = t.documentType === "GENERAL";
  const save = useComplianceMutation(
    () => documentsApi.updateTemplate(general ? { documentType: "GENERAL", expiryWarningDays: Number(f.expiryWarningDays) } : { documentType: t.documentType, footer: f.footer || null, terms: f.terms || null, declaration: f.declaration || null, signatureLabel: f.signatureLabel || null }),
    "Template saved",
  );
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionTitle className="text-base">{TITLES[t.documentType]}</SectionTitle>
      {general ? (
        <Input label="Expiry warning window (days)" type="number" min={1} max={365} value={f.expiryWarningDays} onChange={(e) => set("expiryWarningDays", e.target.value)} description="Documents and certificates expiring within this window are flagged." containerClassName="max-w-xs" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Input label="Footer" value={f.footer} onChange={(e) => set("footer", e.target.value)} maxLength={300} />
          <Input label="Signature label" value={f.signatureLabel} onChange={(e) => set("signatureLabel", e.target.value)} maxLength={200} placeholder="For <exporter> - Authorised signatory" />
          {t.documentType === "COMMERCIAL_INVOICE" && <Textarea label="Default declaration" rows={3} value={f.declaration} onChange={(e) => set("declaration", e.target.value)} maxLength={2000} containerClassName="lg:col-span-2" />}
          <Textarea label="Terms (printed)" rows={3} value={f.terms} onChange={(e) => set("terms", e.target.value)} maxLength={5000} containerClassName="lg:col-span-2" />
        </div>
      )}
      <div className="flex justify-end"><Button size="sm" onClick={() => save.mutate(undefined)} loading={save.isPending}>Save</Button></div>
    </Card>
  );
}
