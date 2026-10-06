"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bookmark, BookmarkCheck, FlaskConical, MapPin, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import type { BuyerRisk, BuyerSearchResult, BuyerVerificationStatus, ContactAvailability } from "@exportpro/types";
import { BUYER_VERIFICATION_LABELS, countryLabel } from "@exportpro/types";
import { buyersApi, findBuyersHref } from "@/lib/api/buyers";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { BUYER_TYPE_LABELS, CONTACT_AVAILABILITY_LABELS, MATCH_LEVEL_LABELS, matchLabel, RISK_LABELS, VERIFICATION_VARIANTS } from "@/lib/buyer-labels";
import { FRESHNESS_LABELS } from "@/lib/opportunity-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ProvenanceBadge } from "@/components/provenance/provenance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption } from "@/components/ui/typography";

/** Impossible-to-miss notice whenever sample buyers are shown. */
export function SampleBuyerBanner({ className }: { className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-lg border-2 border-warning bg-warning/10 p-3 text-sm", className)}>
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">Sample buyer data — not real companies or contacts</p>
        <p className="text-muted-foreground">These fictional records exist to demonstrate buyer discovery. Do not contact them. Real buyer providers can be connected later through Data Sources.</p>
      </div>
    </div>
  );
}

export function MatchScore({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  return (
    <div className="flex flex-col items-start" aria-label={`Buyer match ${score} out of 100, ${matchLabel(score)}`}>
      <span className={cn("font-semibold tabular-nums", size === "lg" ? "text-3xl" : "text-xl")}>{score}<span className="text-xs font-normal text-muted-foreground">/100</span></span>
      <Caption>Match · {matchLabel(score)}</Caption>
    </div>
  );
}

export function RiskBadge({ risk }: { risk: Pick<BuyerRisk, "score" | "level"> }) {
  const r = RISK_LABELS[risk.level];
  const Icon = risk.level === "LOW" ? ShieldCheck : risk.level === "MODERATE" ? ShieldAlert : AlertTriangle;
  return (
    <Badge variant={r.variant} className="gap-1" aria-label={`Buyer risk ${risk.score} out of 100, ${r.label}`}>
      <Icon className="size-3" aria-hidden="true" />
      {r.label} · {risk.score}
    </Badge>
  );
}

export function VerificationBadge({ status }: { status: BuyerVerificationStatus }) {
  return <Badge variant={VERIFICATION_VARIANTS[status]}>{BUYER_VERIFICATION_LABELS[status]}</Badge>;
}

export function ContactBadge({ availability, confidence }: { availability: ContactAvailability; confidence: number | null }) {
  return (
    <Badge variant={availability === "VERIFIED" ? "success" : availability === "HAS_CONTACT" ? "neutral" : "warning"}>
      {CONTACT_AVAILABILITY_LABELS[availability]}
      {confidence !== null && availability !== "NONE" ? ` · ${confidence}%` : ""}
    </Badge>
  );
}

export function SaveBuyerButton({
  buyerId,
  shortlisted,
  productId,
  countryCode,
  size = "sm",
}: {
  buyerId: string;
  shortlisted: boolean;
  productId?: string | null;
  countryCode?: string | null;
  size?: "sm" | "md";
}) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const m = useMutation({
    mutationFn: () => (shortlisted ? buyersApi.unsave(buyerId) : buyersApi.save(buyerId, { productId: productId ?? undefined, countryCode: countryCode ?? undefined })),
    onSuccess: () => {
      toast.success(shortlisted ? "Removed from saved buyers" : "Buyer saved");
      qc.invalidateQueries({ queryKey: ["buyers"] });
    },
    onError: (e) => toast.error("Could not update saved buyers", toFriendlyErrorMessage(e)),
  });
  if (!hasPermission(session, "buyers.save")) return null;
  const Icon = shortlisted ? BookmarkCheck : Bookmark;
  return (
    <Button variant={shortlisted ? "secondary" : "outline"} size={size} aria-pressed={shortlisted} disabled={m.isPending} onClick={() => m.mutate()}>
      <Icon className="size-4" aria-hidden="true" />
      {shortlisted ? "Saved" : "Save"}
    </Button>
  );
}

export function BuyerCard({ b, detailQuery, productId }: { b: BuyerSearchResult; detailQuery: string; productId?: string | null }) {
  const fresh = FRESHNESS_LABELS[b.freshness];
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">
            <Link href={`/buyers/${b.id}${detailQuery}`} className="hover:underline focus-visible:underline">{b.name}</Link>
          </h3>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{[b.city, countryLabel(b.countryCode)].filter(Boolean).join(", ")}</span>
          </p>
        </div>
        <MatchScore score={b.match.score} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="neutral">{BUYER_TYPE_LABELS[b.buyerType]}</Badge>
        <RiskBadge risk={b.risk} />
        <VerificationBadge status={b.verificationStatus} />
        <ContactBadge availability={b.contactAvailability} confidence={b.contactConfidence} />
      </div>
      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="sr-only">Matched product</dt><dd className="truncate">{b.match.matchedHsCode ? `HS ${b.match.matchedHsCode} · ` : ""}{MATCH_LEVEL_LABELS[b.match.level]}</dd></div>
        <div className="min-w-0"><dt className="sr-only">Known activity</dt><dd className="truncate text-muted-foreground">{b.activitySummary}</dd></div>
      </dl>
      {b.match.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Match reasons">
          {b.match.reasons.slice(0, 4).map((r) => (
            <li key={r.text} className={r.positive ? "text-success" : "text-muted-foreground"}>{r.positive ? "✓" : "–"} {r.text}</li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <ProvenanceBadge p={b.provenance} />
          <Badge variant={fresh.variant}>{fresh.label}</Badge>
          <Caption>Data confidence {b.confidence}%</Caption>
          {b.userProvided && <Badge variant="info">Added by your team</Badge>}
          {b.inCrm && <Badge variant="success">Added to CRM</Badge>}
        </div>
        <div className="flex gap-2">
          <SaveBuyerButton buyerId={b.id} shortlisted={b.shortlisted} productId={productId} countryCode={b.countryCode} />
          <Button asChild size="sm">
            <Link href={`/buyers/${b.id}${detailQuery}`} aria-label={`View buyer ${b.name}`}>View buyer</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Contextual entry point. Renders nothing without buyers.view. */
export function FindBuyersButton({
  productId,
  country,
  hsCode,
  variant = "outline",
  size = "sm",
  className,
}: {
  productId?: string | null;
  country?: string | null;
  hsCode?: string | null;
  variant?: "outline" | "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const { data: session } = useSession();
  if (!hasPermission(session, "buyers.view")) return null;
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={findBuyersHref({ productId, country, hsCode })}>
        <Users className="size-4" aria-hidden="true" />
        {country ? `Find buyers in ${countryLabel(country)}` : "Find buyers"}
      </Link>
    </Button>
  );
}
