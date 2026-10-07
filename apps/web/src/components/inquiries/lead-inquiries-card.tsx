"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { inquiriesApi } from "@/lib/api/inquiries";
import { INQUIRY_STATUS } from "@/lib/inquiry-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

/** CRM lead → inquiry count, latest inquiry and links (Sprint 13). */
export function LeadInquiriesCard({ leadId }: { leadId: string }) {
  const { data: session } = useSession();
  const canView = hasPermission(session, "inquiries.view");
  const q = useQuery({ queryKey: ["inquiries", "list", { crmLeadId: leadId, tab: "all" }], queryFn: () => inquiriesApi.list({ crmLeadId: leadId, pageSize: 1 }), enabled: canView });
  if (!canView) return null;
  const latest = q.data?.items[0];
  const total = q.data?.meta.totalItems ?? 0;
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Inquiries &amp; RFQs</SectionTitle>
      {q.isLoading ? (
        <HelperText className="mt-1">Loading…</HelperText>
      ) : !latest ? (
        <HelperText className="mt-1">No inquiries from this lead yet.</HelperText>
      ) : (
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <p>{total} inquir{total === 1 ? "y" : "ies"}. Latest:</p>
          <Link href={`/inquiries/${latest.id}`} className="text-primary hover:underline">{latest.reference} · {latest.subject}</Link>
          <p className="flex items-center gap-2"><Badge variant={INQUIRY_STATUS[latest.status].variant}>{INQUIRY_STATUS[latest.status].label}</Badge><Caption>{new Date(latest.receivedAt).toLocaleDateString()}</Caption></p>
          {total > 1 && <Link className="text-xs text-primary hover:underline" href={`/inquiries?crmLeadId=${leadId}`}>View all</Link>}
        </div>
      )}
      {hasPermission(session, "inquiries.create") && (
        <Button asChild size="sm" variant="outline" className="mt-3"><Link href={`/inquiries?new=1&crmLeadId=${leadId}`}>Add inquiry</Link></Button>
      )}
    </Card>
  );
}
