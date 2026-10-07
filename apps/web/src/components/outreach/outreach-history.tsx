"use client";

import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import { newCampaignHref, outreachApi } from "@/lib/api/outreach";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";
import { fmtDateTime, MessageStatusBadge } from "./outreach-bits";

/** Start Outreach entry point — shared by Buyer Profile and CRM Lead. */
export function StartOutreachButton({ ctx, disabledReason, size = "md" }: { ctx: Parameters<typeof newCampaignHref>[0]; disabledReason?: string | null; size?: "sm" | "md" }) {
  const { data: session } = useSession();
  if (!hasPermission(session, "outreach.create")) return null;
  if (disabledReason)
    return (
      <Button variant="outline" size={size} disabled title={disabledReason} aria-label={`Start outreach (unavailable: ${disabledReason})`}>
        <Send className="size-4" aria-hidden="true" />Start outreach
      </Button>
    );
  return (
    <Button variant="outline" size={size} asChild>
      <Link href={newCampaignHref(ctx)}><Send className="size-4" aria-hidden="true" />Start outreach</Link>
    </Button>
  );
}

/** Organization-scoped communication history for a buyer or a CRM lead. */
export function OutreachHistoryCard({ buyerId, leadId }: { buyerId?: string; leadId?: string }) {
  const { data: session } = useSession();
  const enabled = hasPermission(session, "outreach.view");
  const q = useQuery({
    queryKey: ["outreach", "history", buyerId ?? null, leadId ?? null],
    queryFn: () => (buyerId ? outreachApi.buyerHistory(buyerId) : outreachApi.messages({ leadId, pageSize: 10 }).then((r) => ({ latest: r.items[0] ?? null, messages: r.items, suppressed: false }))),
    enabled,
  });
  if (!enabled) return null;
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Outreach history</SectionTitle>
      <Caption>Campaign emails from your organization only.</Caption>
      {q.isLoading ? (
        <Skeleton className="mt-2 h-16 w-full" />
      ) : q.isError ? (
        <ErrorState className="mt-2" title="History unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.messages.length ? (
        <HelperText className="mt-2">No outreach yet.{q.data?.suppressed ? " This contact has opted out or bounced." : ""}</HelperText>
      ) : (
        <>
          {q.data.suppressed && <p className="mt-2 text-sm text-warning">This buyer’s email is suppressed (opted out or bounced).</p>}
          <ul className="mt-2 flex flex-col gap-2">
            {q.data.messages.slice(0, 5).map((m) => (
              <li key={m.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <MessageStatusBadge status={m.status} simulated={m.simulated} />
                  {m.repliedAt && <Caption>replied {fmtDateTime(m.repliedAt)}</Caption>}
                </div>
                <p className="break-words">{m.subject}</p>
                <Caption>
                  {m.campaign ? <Link className="text-primary hover:underline" href={`/outreach/campaigns/${m.campaign.id}`}>{m.campaign.name}</Link> : "—"} · {fmtDateTime(m.sentAt ?? m.scheduledAt)}
                </Caption>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
