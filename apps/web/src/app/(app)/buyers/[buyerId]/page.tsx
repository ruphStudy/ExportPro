"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, MinusCircle, Send } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { BuyerActivityView, BuyerDetail, ScoreReason } from "@exportpro/types";
import { countryLabel, CRM_STAGE_LABELS } from "@exportpro/types";
import { buyersApi, findBuyersHref } from "@/lib/api/buyers";
import { formatMoney } from "@/lib/api/product-intelligence";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { BUYER_TYPE_LABELS, COMPANY_SIZE_LABELS, FREQUENCY_LABELS, MATCH_LEVEL_LABELS } from "@/lib/buyer-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { MatchScore, RiskBadge, SampleBuyerBanner, SaveBuyerButton, VerificationBadge } from "@/components/buyers/buyer-bits";
import { LinkedQuotationsCard } from "@/components/commercial/entry-points";
import { BuyerFinanceCard } from "@/components/finance/entry-cards";
import { RequirePermission } from "@/components/layout/require-permission";
import { OutreachHistoryCard, StartOutreachButton } from "@/components/outreach/outreach-history";
import { ProvenanceBadge, ProvenanceLine } from "@/components/provenance/provenance";
import { fmtDate } from "@/components/provenance/source-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const NA = <span className="text-muted-foreground">Not available</span>;

export default function BuyerProfilePage() {
  return (
    <RequirePermission permission="buyers.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <BuyerProfile />
      </Suspense>
    </RequirePermission>
  );
}

function BuyerProfile() {
  const { buyerId } = useParams<{ buyerId: string }>();
  const sp = useSearchParams();
  const ctx = { productId: sp.get("productId") ?? undefined, hsCode: sp.get("hsCode") ?? undefined, country: sp.get("country") ?? undefined };
  const q = useQuery({ queryKey: ["buyers", "detail", buyerId, ctx], queryFn: () => buyersApi.detail(buyerId, ctx) });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Buyer not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const b = q.data;
  const backHref = findBuyersHref({ productId: b.context.productId, hsCode: b.context.hsCode, country: b.context.countryCode });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Buyers", href: backHref }, { label: b.name }]} />
      {b.demo && <SampleBuyerBanner />}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle className="break-words">{b.name}</PageTitle>
            <p className="text-sm text-muted-foreground">{[b.city, b.stateRegion, countryLabel(b.countryCode)].filter(Boolean).join(", ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SaveBuyerButton buyerId={b.id} shortlisted={b.orgState.shortlisted} productId={b.context.productId} countryCode={b.context.countryCode ?? b.countryCode} size="md" />
            <AddToCrmButton b={b} />
            <StartOutreachButton
              ctx={{ buyerIds: [b.id], productId: b.context.productId, country: b.context.countryCode ?? b.countryCode }}
              disabledReason={b.contacts.some((c) => c.contactType === "EMAIL" && c.verificationStatus !== "INVALID") ? null : "No usable email contact on record"}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">{BUYER_TYPE_LABELS[b.buyerType]}</Badge>
          <VerificationBadge status={b.verification.status} />
          <RiskBadge risk={b.risk} />
          {b.userProvided && <Badge variant="info">Added by your team (user-provided)</Badge>}
          {!b.active && <Badge variant="warning">No longer listed by any source</Badge>}
        </div>
      </header>

      {b.warnings.filter((w) => w.severity !== "INFO").length > 0 && (
        <section aria-labelledby="concerns-h" className="rounded-lg border border-warning/50 bg-warning/5 p-4">
          <h2 id="concerns-h" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />Requires verification</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {b.warnings.filter((w) => w.severity !== "INFO").map((w) => <li key={w.code}>{w.message}</li>)}
          </ul>
          <Caption className="mt-2 block">These are potential concerns from the data, not evidence of wrongdoing.</Caption>
        </section>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="text-base">Business profile</SectionTitle>
              <ProvenanceBadge p={b.provenance.identity} />
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Website">{b.website ? <a href={b.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary hover:underline">{b.websiteDomain}<ExternalLink className="size-3" aria-hidden="true" /></a> : NA}</Field>
              <Field label="Buyer type">{BUYER_TYPE_LABELS[b.buyerType]}{b.rawBuyerTypes.length > 0 && <Caption className="block">Source terms: {b.rawBuyerTypes.join("; ")}</Caption>}</Field>
              <Field label="Business category">{b.businessCategory ? b.businessCategory.toLowerCase().replace(/_/g, " ") : NA}</Field>
              <Field label="Company size">{b.companySize === "UNKNOWN" ? <span className="text-muted-foreground">Company size unknown</span> : COMPANY_SIZE_LABELS[b.companySize]}{b.employeeRange && <Caption className="block">Source states: {b.employeeRange}</Caption>}</Field>
              <Field label="Address">{b.address ?? NA}</Field>
              <Field label="Known products">{b.knownProducts.length ? b.knownProducts.map((p) => `${p.hsCode ? `HS ${p.hsCode} ` : ""}${p.productName}`).join(" · ") : NA}</Field>
            </dl>
            {b.conflicts.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-primary">Sources disagree on {b.conflicts.length} field{b.conflicts.length > 1 ? "s" : ""}</summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {b.conflicts.map((c) => (
                    <li key={c.field}>
                      <span className="font-medium">{c.field}</span>: showing “{c.chosen}”{c.uncertain && <Badge variant="warning" className="ml-2">Uncertain</Badge>}
                      <ul className="ml-4 list-disc text-xs text-muted-foreground">
                        {c.values.map((v) => <li key={`${v.sourceName}-${v.value}`}>{v.value} — {v.sourceName}{v.sourceUpdatedAt ? `, ${fmtDate(v.sourceUpdatedAt)}` : ""}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {b.possibleDuplicates.length > 0 && (
              <p className="mt-3 text-sm"><Info className="mr-1 inline size-4 text-info" aria-hidden="true" />Possible duplicate (not merged): {b.possibleDuplicates.map((d, i) => <React.Fragment key={d.id}>{i > 0 && ", "}<Link className="text-primary hover:underline" href={`/buyers/${d.id}`}>{d.name}</Link></React.Fragment>)}</p>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle className="text-base">Product match</SectionTitle>
            {b.match.productContextMissing ? (
              <HelperText className="mt-1">No product selected — the score covers non-product factors only. <Link className="text-primary hover:underline" href={backHref}>Choose a product in Buyer Search</Link>.</HelperText>
            ) : (
              <p className="mt-1 text-sm">{b.context.productName ?? "Selected product"}{b.context.hsCode ? ` (HS ${b.context.hsCode})` : ""}: <span className="font-medium">{MATCH_LEVEL_LABELS[b.match.level]}</span>{b.match.matchedProductName ? ` via “${b.match.matchedProductName}”` : ""}</p>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Match score components</caption>
                <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="py-1 text-left font-medium">Component</th><th scope="col" className="py-1 text-right font-medium">Points</th><th scope="col" className="py-1 pl-3 text-left font-medium">Why</th></tr></thead>
                <tbody>
                  {b.match.components.map((c) => (
                    <tr key={c.key} className="border-t border-border">
                      <th scope="row" className="py-1.5 text-left font-normal">{c.label}</th>
                      <td className="py-1.5 text-right tabular-nums">{c.points}/{c.max}</td>
                      <td className="py-1.5 pl-3 text-xs text-muted-foreground">{c.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReasonList reasons={b.match.reasons} label="Match reasons" />
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="text-base">Known trade activity</SectionTitle>
              {b.provenance.activity && <ProvenanceBadge p={b.provenance.activity} />}
            </div>
            <p className="mt-1 text-sm">{FREQUENCY_LABELS[b.importFrequency]}</p>
            {b.tradeActivity.length === 0 ? (
              <HelperText className="mt-2">No import history on record. Directory listings below are not import history.</HelperText>
            ) : (
              <ActivityTable rows={b.tradeActivity} caption="Import history" trade />
            )}
            {b.businessListings.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-medium">Business listings</h3>
                <HelperText>What the company says it deals in — not evidence of actual imports.</HelperText>
                <ActivityTable rows={b.businessListings} caption="Business listings" />
              </>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="text-base">Contacts</SectionTitle>
              {b.provenance.contacts && <ProvenanceBadge p={b.provenance.contacts} />}
            </div>
            {b.contacts.length === 0 ? (
              <HelperText className="mt-2">Contact not available. No contact details are inferred or guessed.</HelperText>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {b.contacts.map((c) => (
                  <li key={c.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{c.name ?? c.role ?? "General contact"}{c.name && c.role ? <span className="font-normal text-muted-foreground"> · {c.role}</span> : null}{c.isPrimary && <Badge variant="neutral" className="ml-2">Primary</Badge>}</p>
                        <p className="break-all">
                          <span className="text-muted-foreground">{c.contactType.toLowerCase().replace(/_/g, " ")}: </span>
                          {c.contactType === "WEBSITE_FORM" ? <a className="text-primary hover:underline" href={c.value} target="_blank" rel="noopener noreferrer nofollow">{c.value}</a> : c.value}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={c.verificationStatus === "VERIFIED" ? "success" : c.verificationStatus === "INVALID" ? "danger" : c.verificationStatus === "STALE" ? "warning" : "neutral"}>{c.verificationLabel}</Badge>
                        <Caption>Contact confidence: {c.confidence}% — {c.confidenceLabel}</Caption>
                      </div>
                    </div>
                    {c.evidence.length > 0 && <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" aria-label="Supporting evidence">{c.evidence.map((e) => <li key={e}>• {e}</li>)}</ul>}
                    <Caption className="mt-1 block">{c.sourceName}{c.lastCheckedAt ? ` · last checked ${fmtDate(c.lastCheckedAt)}` : ""}{c.verifiedAt ? ` · verified ${fmtDate(c.verifiedAt)}` : ""}{c.demo ? " · sample contact — do not use" : ""}</Caption>
                  </li>
                ))}
              </ul>
            )}
            <Caption className="mt-2 block">Email deliverability is not tested. Outreach is not available in Buyer Discovery.</Caption>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <MatchScore score={b.match.score} size="lg" />
              <div className="text-right">
                <p className="text-3xl font-semibold tabular-nums" aria-hidden="true">{b.risk.score}<span className="text-xs font-normal text-muted-foreground">/100</span></p>
                <RiskBadge risk={b.risk} />
              </div>
            </div>
            <HelperText>{scoreSentence(b)}</HelperText>
            <div>
              <h3 className="text-sm font-medium">Risk factors</h3>
              <ReasonList reasons={b.risk.reasons} label="Risk reasons" />
            </div>
            <div>
              <h3 className="text-sm font-medium">Company verification</h3>
              <p className="mt-1 text-sm">{b.verification.label}</p>
              <HelperText>{b.verification.explanation}</HelperText>
              <Caption>Checked {fmtDate(b.verification.checkedAt)}</Caption>
            </div>
            <div>
              <h3 className="text-sm font-medium">Best contact confidence</h3>
              <p className="text-sm">{b.contactConfidence === null ? "Contact not available" : `${b.contactConfidence}%`}</p>
              <Caption>Separate from company verification.</Caption>
            </div>
          </Card>

          <NotesCard key={b.orgState.notesUpdatedAt ?? "none"} b={b} />
          <OutreachHistoryCard buyerId={b.id} />
          <BuyerFinanceCard buyerId={b.id} />
          <LinkedQuotationsCard filter={{ buyerCompanyId: b.id }} create={{ buyerCompanyId: b.id }} title="Quotations for this buyer" />

          <Card className="p-4">
            <SectionTitle className="text-base">Source &amp; reliability</SectionTitle>
            <ul className="mt-3 flex flex-col gap-3">
              {b.sources.map((s) => (
                <li key={s.id} className="text-sm">
                  <ProvenanceLine p={s.provenance} />
                  <Caption className="block">
                    {s.externalId ? `Ref ${s.externalId} · ` : ""}retrieved {fmtDate(s.retrievedAt)} · source updated {fmtDate(s.sourceUpdatedAt)} · last seen {fmtDate(s.lastSeenAt)}{s.active ? "" : " · no longer returned (kept for lineage)"}
                  </Caption>
                  {s.sourceUrl && <a className="text-xs text-primary hover:underline" href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">View source record</a>}
                </li>
              ))}
            </ul>
            {b.enrichment.warnings.map((w) => <p key={w} className="mt-2 text-xs text-muted-foreground">{w}</p>)}
            <Caption className="mt-3 block">Enriched {fmtDate(b.enrichment.enrichedAt)} · {b.scoreVersion} · dataset {b.datasetVersion}</Caption>
          </Card>
        </div>
      </div>
    </div>
  );
}

function scoreSentence(b: BuyerDetail) {
  const strong = b.match.score >= 75;
  const risky = b.risk.level === "HIGH" || b.risk.level === "VERY_HIGH";
  if (strong && risky) return "Excellent commercial fit, but this record needs verification before you engage.";
  if (strong) return "Strong commercial fit with acceptable credibility signals.";
  if (risky) return "Limited fit and credibility concerns — lower priority.";
  return "Moderate fit. Review the reasons below.";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function ReasonList({ reasons, label }: { reasons: ScoreReason[]; label: string }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label={label}>
      {reasons.map((r) => (
        <li key={r.text} className="flex items-start gap-2">
          {r.positive ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <MinusCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />}
          <span><span className="sr-only">{r.positive ? "Positive: " : "Caution: "}</span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ActivityTable({ rows, caption, trade }: { rows: BuyerActivityView[]; caption: string; trade?: boolean }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {["Product / HS", ...(trade ? ["Frequency", "Shipments (12m)", "Value", "Quantity", "Origins", "First", "Last"] : []), "Source"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="px-3 py-2">{a.productName}{a.hsCode && <Caption className="block">HS {a.hsCode}</Caption>}</td>
              {trade && (
                <>
                  <td className="px-3 py-2">{a.importFrequency === "UNKNOWN" ? "Unknown" : FREQUENCY_LABELS[a.importFrequency].replace(" importer", "")}</td>
                  <td className="px-3 py-2 tabular-nums">{a.transactionCount ?? "—"}</td>
                  <td className="px-3 py-2">{a.importValueUsd === null ? "Not available" : formatMoney(a.importValueUsd, "USD")}</td>
                  <td className="px-3 py-2">{a.importQuantity === null ? "Not available" : `${a.importQuantity.toLocaleString()} ${a.quantityUnit ?? ""}`}</td>
                  <td className="px-3 py-2">{a.originCountries.length ? a.originCountries.join(", ") : "—"}</td>
                  <td className="px-3 py-2">{fmtDate(a.firstActivityDate)}</td>
                  <td className="px-3 py-2">{fmtDate(a.lastActivityDate)}</td>
                </>
              )}
              <td className="px-3 py-2 text-xs text-muted-foreground">{a.sourceName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddToCrmButton({ b }: { b: BuyerDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: session } = useSession();
  const m = useMutation({
    mutationFn: () => buyersApi.addToCrm(b.id, { productId: b.context.productId ?? undefined, countryCode: b.context.countryCode ?? b.countryCode }),
    onSuccess: (r) => {
      toast.success(r.alreadyAdded ? "Already in CRM" : "Added to CRM", r.alreadyAdded ? "No duplicate lead was created." : "The lead is now in the CRM pipeline as New.");
      qc.invalidateQueries({ queryKey: ["buyers"] });
      qc.invalidateQueries({ queryKey: ["crm"] });
      if (!r.alreadyAdded && hasPermission(session, "crm.view")) router.push(`/crm/leads/${r.leadId}`);
    },
    onError: (e) => toast.error("Could not add to CRM", toFriendlyErrorMessage(e)),
  });
  const lead = b.orgState.lead;
  // Current organization's lead only (the API never returns another tenant's CRM state).
  if (lead && (lead.productId ?? null) === (b.context.productId ?? null))
    return (
      <div className="flex flex-wrap items-center gap-2" role="status">
        <Badge variant="success" className="h-9 px-3 text-sm">In CRM · {CRM_STAGE_LABELS[lead.stage]}{lead.ownerName ? ` · ${lead.ownerName}` : " · Unassigned"}</Badge>
        {hasPermission(session, "crm.view") && (
          <Button variant="outline" asChild><Link href={`/crm/leads/${lead.id}`}>View CRM lead</Link></Button>
        )}
      </div>
    );
  if (!hasPermission(session, "buyers.crm_handoff")) return null;
  return (
    <Button onClick={() => m.mutate()} disabled={m.isPending}>
      <Send className="size-4" aria-hidden="true" />
      {m.isPending ? "Adding…" : "Add to CRM"}
    </Button>
  );
}

function NotesCard({ b }: { b: BuyerDetail }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [value, setValue] = React.useState(b.orgState.notes ?? "");
  const canEdit = hasPermission(session, "buyers.notes");
  const m = useMutation({
    mutationFn: () => buyersApi.notes(b.id, value),
    onSuccess: () => {
      toast.success("Notes saved");
      qc.invalidateQueries({ queryKey: ["buyers", "detail", b.id] });
    },
    onError: (e) => toast.error("Could not save notes", toFriendlyErrorMessage(e)),
  });
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Notes</SectionTitle>
      <HelperText>Private to your organization.</HelperText>
      {canEdit ? (
        <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Textarea label="Buyer notes" value={value} onChange={(e) => setValue(e.target.value)} rows={5} maxLength={5000} error={value.length > 5000 ? "Notes can be at most 5,000 characters." : undefined} />
          <div className="flex items-center justify-between">
            <Caption>{b.orgState.notesUpdatedAt ? `Updated ${fmtDate(b.orgState.notesUpdatedAt)}` : "No notes yet"}</Caption>
            <Button type="submit" size="sm" disabled={m.isPending || value === (b.orgState.notes ?? "")}>{m.isPending ? "Saving…" : "Save notes"}</Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm">{b.orgState.notes ?? <span className="text-muted-foreground">No notes.</span>}</p>
      )}
    </Card>
  );
}
