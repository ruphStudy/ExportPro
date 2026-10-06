"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Contact } from "lucide-react";
import Link from "next/link";
import { crmApi } from "@/lib/api/crm";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, SectionTitle } from "@/components/ui/typography";

/** Sprint 11 dashboard hook: the current user's CRM follow-ups. Hidden when there is nothing due. */
export function CrmFollowUpSummary() {
  const { data: session } = useSession();
  const canView = hasPermission(session, "crm.view");
  const q = useQuery({ queryKey: ["crm", "attention", "mine"], queryFn: () => crmApi.attention("mine"), enabled: canView });
  if (!canView || !q.data) return null;
  const c = q.data.counts;
  const items = [
    { label: "Overdue tasks", value: c.OVERDUE_TASK },
    { label: "Overdue next actions", value: c.OVERDUE_NEXT_ACTION },
    { label: "Stale leads", value: c.STALE_LEAD },
    { label: "Reminders due", value: c.REMINDER_DUE },
  ];
  if (items.every((i) => i.value === 0)) return null;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Contact className="mt-0.5 size-5 text-primary" aria-hidden="true" />
        <div>
          <SectionTitle className="text-base">CRM follow-ups</SectionTitle>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {items.map((i) => (
              <li key={i.label}>
                <span className={i.value ? "font-semibold text-warning" : "font-semibold"}>{i.value}</span> <Caption>{i.label}</Caption>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link href="/crm?view=follow-up">Open follow-ups<ArrowRight className="size-4" aria-hidden="true" /></Link>
      </Button>
    </Card>
  );
}
