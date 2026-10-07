"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { ComplianceOverview, ComplianceRuleView } from "@exportpro/types";
import { countryLabel } from "@exportpro/types";
import { complianceApi } from "@/lib/api/compliance";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { BASIS, COVERAGE, EXPIRY, LEVEL, PARTY, READINESS, SEVERITY } from "@/lib/compliance-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { ComplianceSectionTabs, Provenance } from "@/components/compliance/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function CompliancePage() {
  return (
    <RequirePermission permission="compliance.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ComplianceHome />
      </Suspense>
    </RequirePermission>
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "checklists", label: "Transaction checklists" },
  { key: "registrations", label: "Registrations" },
  { key: "certifications", label: "Certifications" },
  { key: "rules", label: "Rules & sources" },
] as const;

function ComplianceHome() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const tab = (params.get("tab") ?? "overview") as (typeof TABS)[number]["key"];
  const q = useQuery({ queryKey: ["compliance", "overview"], queryFn: complianceApi.overview });
  const showRules = hasPermission(session, "compliance.manage");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Documents &amp; Compliance</PageTitle>
        <HelperText className="mt-1">Deterministic compliance checklists per order, based on sourced rules and your registrations. ExportPro tracks requirements and evidence — it does not verify documents with authorities or issue official certificates.</HelperText>
      </div>
      <ComplianceSectionTabs />
      <div role="tablist" aria-label="Compliance views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.filter((t) => t.key !== "rules" || showRules).map((t) => (
          <Button key={t.key} role="tab" aria-selected={tab === t.key} size="sm" variant={tab === t.key ? "secondary" : "ghost"} onClick={() => router.replace(`${pathname}${t.key === "overview" ? "" : `?tab=${t.key}`}`, { scroll: false })}>{t.label}</Button>
        ))}
      </div>
      {tab === "rules" ? (
        showRules ? <Rules /> : null
      ) : q.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : q.isError || !q.data ? (
        <ErrorState title="Could not load compliance" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : tab === "overview" ? (
        <Overview o={q.data} />
      ) : tab === "checklists" ? (
        <Checklists o={q.data} />
      ) : tab === "registrations" ? (
        <Registrations o={q.data} />
      ) : (
        <Certifications o={q.data} />
      )}
    </div>
  );
}

function Overview({ o }: { o: ComplianceOverview }) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Checklists by readiness">
        {(["BLOCKED", "READY_WITH_WARNINGS", "READY", "NOT_READY"] as const).map((k) => (
          <li key={k}><Card className="p-3"><Caption>{READINESS[k].label}</Caption><p className="text-2xl font-semibold">{o.counts[k]}</p></Card></li>
        ))}
      </ul>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle className="text-base">Top blockers</SectionTitle>
          {!o.topBlockers.length ? <HelperText className="mt-1">No open blockers on evaluated orders.</HelperText> : (
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {o.topBlockers.map((b, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><Badge variant="danger">Blocker</Badge> {b.name} <Caption>— {b.reason}</Caption></span>
                  <ChecklistLink id={b.checklistId} label={b.label} o={o} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <SectionTitle className="text-base">Accepted orders without a checklist</SectionTitle>
          {!o.acceptedPosWithoutChecklist.length ? <HelperText className="mt-1">Every accepted buyer PO has been evaluated.</HelperText> : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {o.acceptedPosWithoutChecklist.map((p) => <li key={p.id}><Link className="text-primary hover:underline" href={`/compliance/orders/${p.id}`}>PO {p.poNumber}</Link> <Caption>· {p.buyerName}</Caption></li>)}
            </ul>
          )}
        </Card>
      </div>
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <span>Documents expiring soon: <strong>{o.expiringDocuments}</strong></span>
        <span>Expired: <strong>{o.expiredDocuments}</strong></span>
        <Link className="text-primary hover:underline" href="/documents?tab=expiring">Review expiring documents</Link>
      </Card>
    </div>
  );
}

function ChecklistLink({ id, label, o }: { id: string; label: string; o: ComplianceOverview }) {
  const c = o.checklists.find((x) => x.id === id);
  const href = c?.purchaseOrder ? `/compliance/orders/${c.purchaseOrder.id}` : c?.quotation ? `/compliance/quotations/${c.quotation.id}` : "/compliance";
  return <Link className="text-primary hover:underline" href={href}>{label}</Link>;
}

function Checklists({ o }: { o: ComplianceOverview }) {
  if (!o.checklists.length)
    return <EmptyState icon={ShieldCheck} title="No compliance checklists yet" description="Evaluate compliance from an accepted buyer purchase order." action={<Button asChild size="sm" variant="outline"><Link href="/purchase-orders?status=ACCEPTED">View accepted POs</Link></Button>} />;
  return (
    <ul className="flex flex-col gap-2" aria-label="Transaction checklists">
      {o.checklists.map((c) => (
        <li key={c.id}>
          <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <Link className="font-medium text-primary hover:underline" href={c.purchaseOrder ? `/compliance/orders/${c.purchaseOrder.id}` : `/compliance/quotations/${c.quotation?.id}`}>{c.purchaseOrder ? `PO ${c.purchaseOrder.poNumber}` : `${c.quotation?.displayNumber} (provisional)`}</Link>
              <Caption className="block">{c.buyerName}{c.destinationCountry ? ` → ${countryLabel(c.destinationCountry)}` : " · destination unknown"} · evaluated {new Date(c.evaluatedAt).toLocaleDateString()}</Caption>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={READINESS[c.readiness].variant}>{READINESS[c.readiness].label}</Badge>
              {c.blockers > 0 && <Badge variant="danger">{c.blockers} blocker{c.blockers === 1 ? "" : "s"}</Badge>}
              {c.warnings > 0 && <Badge variant="warning">{c.warnings} warning{c.warnings === 1 ? "" : "s"}</Badge>}
              <Badge variant={COVERAGE[c.coverage].variant}>Coverage: {c.coverage.toLowerCase()}</Badge>
              {c.readyConfirmed && <Badge variant="success">Ready confirmed</Badge>}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Registrations({ o }: { o: ComplianceOverview }) {
  return (
    <Card className="p-4">
      <HelperText>From your organization registrations (Export setup). Statuses are as declared/uploaded — ExportPro does not verify registrations with authorities.</HelperText>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Registrations</caption>
          <thead className="text-xs text-muted-foreground"><tr>{["Registration", "Status", "Number", "Verification", "Expiry", "Evidence"].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {o.registrations.map((r) => (
              <tr key={r.type} className="border-t border-border">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">{r.type}</th>
                <td className="px-2 py-1.5">{r.status.replace(/_/g, " ").toLowerCase()}</td>
                <td className="px-2 py-1.5">{r.number ?? "—"}</td>
                <td className="px-2 py-1.5">{r.verificationNote}</td>
                <td className="px-2 py-1.5">{r.expiryDate ?? "—"}{r.expiry && r.expiry !== "VALID" && <Badge className="ml-1" variant={EXPIRY[r.expiry].variant}>{EXPIRY[r.expiry].label}</Badge>}</td>
                <td className="px-2 py-1.5">{r.hasEvidence ? "Uploaded" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button asChild size="sm" variant="outline" className="mt-3"><Link href="/export-setup">Update registrations</Link></Button>
    </Card>
  );
}

function Certifications({ o }: { o: ComplianceOverview }) {
  if (!o.certifications.length) return <EmptyState icon={ShieldCheck} title="No certifications recorded" description="Add certifications (e.g. Spices Board CRES, ISO, HACCP) in Export setup." action={<Button asChild size="sm" variant="outline"><Link href="/export-setup">Open export setup</Link></Button>} />;
  return (
    <ul className="flex flex-col gap-2" aria-label="Certifications">
      {o.certifications.map((c) => (
        <li key={c.id}>
          <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{c.name} <Caption>({c.type})</Caption></p>
              <Caption className="block">{[c.number, c.issuer, c.expiryDate ? `expires ${c.expiryDate}` : null].filter(Boolean).join(" · ") || "No details"} · {c.verificationStatus.replace(/_/g, " ").toLowerCase()} — not verified by ExportPro</Caption>
            </div>
            <div className="flex gap-1.5">
              {c.expiry && <Badge variant={EXPIRY[c.expiry].variant}>{EXPIRY[c.expiry].label}</Badge>}
              <Badge variant={c.hasEvidence ? "success" : "neutral"}>{c.hasEvidence ? "Evidence uploaded" : "No evidence file"}</Badge>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Rules() {
  const q = useQuery({ queryKey: ["compliance", "rules"], queryFn: complianceApi.rules });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Could not load rules" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const groups: [string, ComplianceRuleView[]][] = [
    ["India export", q.data.filter((r) => r.jurisdiction === "INDIA_EXPORT")],
    ["Destination import (curated subset — not complete law)", q.data.filter((r) => r.jurisdiction === "DESTINATION_IMPORT")],
    ["Transaction documents", q.data.filter((r) => r.jurisdiction === "TRANSACTION")],
  ];
  return (
    <div className="flex flex-col gap-4">
      <HelperText>Platform rules are versioned and read-only. Evaluations keep the rule version they used. Add order-specific items as user-defined requirements on a checklist.</HelperText>
      {groups.map(([title, rules]) => (
        <Card key={title} className="p-4">
          <SectionTitle className="text-base">{title}</SectionTitle>
          <ul className="mt-2 flex flex-col gap-3">
            {rules.map((r) => (
              <li key={r.id} className="text-sm">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  {r.name}
                  <Badge variant={LEVEL[r.level].variant}>{LEVEL[r.level].label}</Badge>
                  <Badge variant={SEVERITY[r.severity].variant}>{SEVERITY[r.severity].label}</Badge>
                  <Badge variant="neutral">{BASIS[r.basis]}</Badge>
                  <Caption>v{r.version}</Caption>
                </p>
                <p className="text-muted-foreground">{r.description}</p>
                <Caption className="block">Scope: {[r.countryCode && `destination ${r.countryCode}`, r.hsPrefixes.length && `HS ${r.hsPrefixes.join(", ")}`].filter(Boolean).join(" · ") || "all exports"} · provided by {PARTY[r.responsibleParty].toLowerCase()} · satisfied by: {r.satisfiedBy}</Caption>
                <Provenance p={r.provenance} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
