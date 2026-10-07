"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import Link from "next/link";
import { costingApi, fmtMoney, fmtPct } from "@/lib/api/costing";
import { STATUS_LABELS } from "@/lib/costing-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

function href(ctx: { productId?: string | null; country?: string | null; crmLeadId?: string | null; buyerCompanyId?: string | null }) {
  const s = new URLSearchParams();
  if (ctx.productId) s.set("productId", ctx.productId);
  if (ctx.country) s.set("country", ctx.country);
  if (ctx.crmLeadId) s.set("crmLeadId", ctx.crmLeadId);
  if (ctx.buyerCompanyId) s.set("buyerCompanyId", ctx.buyerCompanyId);
  return `/costing/new${s.toString() ? `?${s}` : ""}`;
}

/** Contextual entry point; renders nothing without costing.create. */
export function CreateCostingButton({ className, size = "sm", variant = "outline", ...ctx }: { productId?: string | null; country?: string | null; crmLeadId?: string | null; buyerCompanyId?: string | null; className?: string; size?: "sm" | "md"; variant?: "outline" | "primary" }) {
  const { data: session } = useSession();
  if (!hasPermission(session, "costing.create")) return null;
  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={href(ctx)}><Calculator className="size-4" aria-hidden="true" />Create export costing</Link>
    </Button>
  );
}

/** Compact costing summary for CRM lead detail (latest costings + create). */
export function LeadCostingsCard({ leadId }: { leadId: string }) {
  const { data: session } = useSession();
  const canView = hasPermission(session, "costing.view");
  const q = useQuery({ queryKey: ["costings", "list", { crmLeadId: leadId }], queryFn: () => costingApi.list({ crmLeadId: leadId, pageSize: 3 }), enabled: canView });
  if (!canView) return null;
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Export costings</SectionTitle>
      {q.isLoading ? (
        <HelperText className="mt-1">Loading…</HelperText>
      ) : !q.data?.items.length ? (
        <HelperText className="mt-1">No costing for this lead yet.</HelperText>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {q.data.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/costing/${c.id}`} className="font-medium text-primary hover:underline">{c.reference}</Link>
              <span className="flex items-center gap-2">
                <Caption>{c.base ? `${c.base.incoterm} · ${c.base.totalCost ? fmtMoney(c.base.totalCost, c.calculationCurrency) : "incomplete"} · margin ${fmtPct(c.base.marginPercent)}` : ""}</Caption>
                <Badge variant={STATUS_LABELS[c.status].variant}>{STATUS_LABELS[c.status].label}</Badge>
              </span>
            </li>
          ))}
          {q.data.meta.totalItems > 3 && <li><Link className="text-xs text-primary hover:underline" href={`/costing?crmLeadId=${leadId}`}>View all {q.data.meta.totalItems}</Link></li>}
        </ul>
      )}
      <CreateCostingButton crmLeadId={leadId} className="mt-3" />
    </Card>
  );
}
