"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { money, NOT_ACCOUNTING_PROC, ProcurementTabs } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ProcurementOverviewPage() {
  return (
    <RequirePermission permission="procurement.view">
      <Overview />
    </RequirePermission>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ["procurement", "overview"], queryFn: procurementApi.overview });
  const o = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Procurement</PageTitle>
        <HelperText className="mt-1">Suppliers, supplier RFQs and quotes, supplier POs, goods receipt, quality and supplier payables. {NOT_ACCOUNTING_PROC}</HelperText>
      </div>
      <ProcurementTabs />
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !o ? (
        <ErrorState title="Could not load procurement overview" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Procurement overview">
            {([
              ["Suppliers", o.suppliers, "/procurement/suppliers"],
              ["Open supplier RFQs", o.openRfqs, "/procurement/rfqs"],
              ["Quotes awaiting review", o.quotesAwaitingReview, "/procurement/rfqs"],
              ["Open supplier POs", o.openSupplierPos, "/procurement/orders"],
              ["Delayed deliveries", o.delayed, "/procurement/orders?overdue=true"],
              ["Awaiting inspection", o.awaitingInspection, "/procurement/receipts?quality=PENDING"],
              ["Quality holds / failures", o.qualityHolds, "/procurement/receipts?quality=HOLD"],
              ["Supplier payments due", o.paymentsDue, "/procurement/payables"],
            ] as const).map(([k, v, href]) => (
              <li key={k}>
                <Link href={href} className="block h-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <Card className="h-full p-3 hover:bg-muted/40"><Caption>{k}</Caption><p className="text-lg font-semibold">{v}</p></Card>
                </Link>
              </li>
            ))}
          </ul>
          {o.overduePayables.length > 0 && <Caption>Overdue supplier payables: {o.overduePayables.map((x) => money(x.amount, x.currency)).join(" · ")}</Caption>}
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">Needs attention</SectionTitle>
            <ul className="mt-2 flex flex-col gap-1.5">
              {o.actions.map((x) => <li key={x.kind}><Link className="text-primary hover:underline" href={x.href}>{x.title}</Link></li>)}
              {!o.actions.length && <li className="text-muted-foreground">Nothing needs attention right now.</li>}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
