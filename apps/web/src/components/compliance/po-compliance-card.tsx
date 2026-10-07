"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { complianceApi, documentsApi } from "@/lib/api/compliance";
import { DOC_STATUS, DOC_TYPE, READINESS } from "@/lib/compliance-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

/** PO detail → compliance readiness, open blockers and document status (Sprint 16). */
export function PoComplianceCard({ purchaseOrderId }: { purchaseOrderId: string }) {
  const { data: session } = useSession();
  const canC = hasPermission(session, "compliance.view");
  const canD = hasPermission(session, "documents.view");
  const cl = useQuery({ queryKey: ["compliance", "checklists", { purchaseOrderId }], queryFn: () => complianceApi.checklists({ purchaseOrderId }), enabled: canC });
  const docs = useQuery({ queryKey: ["documents", "list", { purchaseOrderId, card: true }], queryFn: () => documentsApi.list({ purchaseOrderId, pageSize: 10 }), enabled: canD });
  if (!canC && !canD) return null;
  const c = cl.data?.[0];
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <SectionTitle className="text-base">Compliance &amp; documents</SectionTitle>
      {canC && (cl.isLoading ? <HelperText>Loading…</HelperText> : c ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={READINESS[c.readiness].variant}>{READINESS[c.readiness].label}</Badge>
          {c.blockers > 0 && <Badge variant="danger">{c.blockers} open blocker{c.blockers === 1 ? "" : "s"}</Badge>}
          {c.warnings > 0 && <Badge variant="warning">{c.warnings} warning{c.warnings === 1 ? "" : "s"}</Badge>}
          {c.readyConfirmed && <Badge variant="success">Ready confirmed</Badge>}
        </div>
      ) : <HelperText>Compliance not evaluated yet.</HelperText>)}
      {canD && docs.data && (
        docs.data.items.length ? (
          <ul className="flex flex-col gap-1">
            {docs.data.items.map((d) => <li key={d.id} className="flex items-center justify-between gap-2"><Link className="truncate text-primary hover:underline" href={`/documents/${d.id}`}>{DOC_TYPE[d.documentType]}{d.documentNumber ? ` ${d.documentNumber}` : ""}</Link><Badge variant={DOC_STATUS[d.status].variant}>{DOC_STATUS[d.status].label}</Badge></li>)}
          </ul>
        ) : <Caption>No documents for this order yet.</Caption>
      )}
      <div className="flex flex-wrap gap-2">
        {canC && <Button asChild size="sm" variant="outline"><Link href={`/compliance/orders/${purchaseOrderId}`}>View compliance</Link></Button>}
        {canD && <Button asChild size="sm" variant="ghost"><Link href={`/documents?purchaseOrderId=${purchaseOrderId}`}>Documents</Link></Button>}
      </div>
    </Card>
  );
}
