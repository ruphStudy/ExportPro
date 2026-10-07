"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { complianceApi } from "@/lib/api/compliance";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ChecklistView } from "./checklist-view";
import { useComplianceMutation } from "./shared";

/** Loads (or offers to evaluate) the checklist for a PO or, provisionally, a quotation. */
export function ChecklistPage({ anchor }: { anchor: { purchaseOrderId: string } | { quotationId: string } }) {
  const { data: session } = useSession();
  const isPo = "purchaseOrderId" in anchor;
  const id = isPo ? anchor.purchaseOrderId : anchor.quotationId;
  const q = useQuery({
    queryKey: ["compliance", "checklist", id],
    queryFn: () => (isPo ? complianceApi.forPo(id) : complianceApi.forQuotation(id)),
    retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2,
  });
  const evaluate = useComplianceMutation(() => (isPo ? complianceApi.evaluatePo(id) : complianceApi.evaluateQuotation(id)), "Compliance evaluated");
  const notEvaluated = q.error instanceof ApiRequestError && (q.error.details as { code?: string } | undefined)?.code === "NOT_EVALUATED";
  const crumbs = <Breadcrumbs items={[{ label: "Documents & Compliance", href: "/compliance" }, { label: q.data ? (q.data.purchaseOrder ? `PO ${q.data.purchaseOrder.poNumber}` : (q.data.quotation?.displayNumber ?? "Checklist")) : "Checklist" }]} />;
  if (q.isLoading) return <PageSkeleton />;
  if (notEvaluated)
    return (
      <div className="flex flex-col gap-5">
        {crumbs}
        <EmptyState
          icon={ShieldCheck}
          title="Compliance not evaluated yet"
          description={isPo ? "Evaluate the deterministic rule set against this order’s products, destination, Incoterm and your registrations." : "Create a provisional checklist from this quotation. It becomes final once a buyer PO is accepted."}
          action={hasPermission(session, "compliance.manage") ? <Button size="sm" onClick={() => evaluate.mutate(undefined)} loading={evaluate.isPending}>Evaluate compliance</Button> : undefined}
        />
      </div>
    );
  if (q.isError || !q.data) return <ErrorState title="Checklist not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {crumbs}
      <ChecklistView d={q.data} onReevaluate={() => evaluate.mutate(undefined)} reevaluating={evaluate.isPending} />
    </div>
  );
}
