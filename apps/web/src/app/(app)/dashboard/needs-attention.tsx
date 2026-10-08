"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { actionCenterApi } from "@/lib/api/ai-ops";
import { PriorityBadge, useCan } from "@/components/ai-ops/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

/** Dashboard → top Action Center items (deterministic priority). */
export function NeedsAttention() {
  const can = useCan();
  const view = can("action_center.view");
  const q = useQuery({ queryKey: ["ops", "items", "dashboard"], queryFn: () => actionCenterApi.list({ pageSize: 5 }), enabled: view });
  if (!view) return null;
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Needs your attention</SectionTitle>
        <Button asChild size="sm" variant="ghost"><Link href="/action-center">Action Center →</Link></Button>
      </div>
      {q.isLoading ? <Skeleton className="h-20 w-full" /> : !q.data?.items.length ? <HelperText>No urgent actions.</HelperText> : (
        <>
          <Caption>{q.data.summary.open} open · {q.data.summary.critical} critical · {q.data.summary.overdue} overdue</Caption>
          <ul className="flex flex-col gap-1.5">{q.data.items.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2"><PriorityBadge p={i.priority} /><Link className="min-w-0 break-words text-primary hover:underline" href={i.links[0]?.href ?? "/action-center"}>{i.title}</Link></li>)}</ul>
        </>
      )}
    </Card>
  );
}
