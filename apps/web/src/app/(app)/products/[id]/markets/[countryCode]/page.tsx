"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Globe2, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { countryLabel, formatTariffCode, type MarketDeepAnalysis } from "@exportpro/types";
import { marketsApi } from "@/lib/api/markets";
import { formatMoney, formatPercent, formatQuantity } from "@/lib/api/product-intelligence";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { RequirePermission } from "@/components/layout/require-permission";
import {
  ContextBadges,
  MarketSourcePanel,
  Meta,
  RegulatoryNotice,
  riskVariant,
  ScorePill,
  titleCase,
  VERIFICATION_LABELS,
} from "@/components/markets/market-bits";
import { ShareList, TrendChart } from "@/components/product-intelligence/trend-chart";
import { CodeLabel } from "@/components/products/classification-bits";
import { ProvenanceBadge } from "@/components/provenance/provenance";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const CERT_STATUS: Record<string, string> = {
  COMMONLY_REQUESTED: "Commonly requested",
  POTENTIALLY_REQUIRED: "Potentially required",
  VERIFY_APPLICABILITY: "Verify applicability",
};

export default function MarketAnalysisPage() {
  return (
    <RequirePermission permission="country_intelligence.view">
      <MarketAnalysisContent />
    </RequirePermission>
  );
}

function MarketAnalysisContent() {
  const { id, countryCode } = useParams<{ id: string; countryCode: string }>();
  const query = useQuery({ queryKey: ["market-analysis", id, countryCode], queryFn: () => marketsApi.deepAnalysis(id, countryCode) });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading market analysis">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState title="Market analysis couldn't load" message={toFriendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />;
  }
  const d = query.data;
  const crumbs = [
    { label: "Products", href: "/products" },
    { label: d.product.displayName, href: `/products/${d.product.id}` },
    { label: "Best Markets", href: `/products/${d.product.id}/markets` },
    { label: d.country?.name ?? countryCode.toUpperCase() },
  ];
  if (d.status !== "AVAILABLE") {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={crumbs} />
        <PageTitle className="break-words">{d.product.displayName} → {d.country?.name ?? countryCode.toUpperCase()}</PageTitle>
        <EmptyState
          icon={d.status === "CLASSIFICATION_REQUIRED" ? ShieldAlert : d.status === "COUNTRY_NOT_SUPPORTED" ? Globe2 : Database}
          title={d.status === "CLASSIFICATION_REQUIRED" ? "Classification confirmation required" : "Market data unavailable"}
          description={d.message}
          action={<Button asChild variant="outline"><Link href={`/products/${d.product.id}/markets`}>See supported markets</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={crumbs} />
      <Header a={d} />
      <MarketSourcePanel
        source={d.source}
        confidence={d.confidence}
        provenance={d.provenance}
        provenanceLabels={{
          marketSize: "Market size",
          importTrend: "Import trend",
          indiaPosition: "India position",
          competition: "Competing suppliers",
          pricing: "Pricing benchmark",
          tariff: "Tariff",
          barriers: "Trade barriers",
          guidance: "Packaging, labeling & certifications",
          logistics: "Logistics",
          risk: "Country & currency risk",
          score: "Market opportunity score",
        }}
      />
      <Summary a={d} />
      <DemandSection a={d} />
      <IndiaAndCompetition a={d} />
      <TariffSection a={d} />
      <GuidanceSection a={d} />
      <LogisticsAndRisk a={d} />
    </div>
  );
}

function Growth({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium", up ? "text-success" : "text-danger")}>
      {up ? <TrendingUp className="size-3.5" aria-hidden="true" /> : <TrendingDown className="size-3.5" aria-hidden="true" />}
      {formatPercent(value)}
      <span className="sr-only">{up ? "increase" : "decrease"}</span>
    </span>
  );
}

function Header({ a }: { a: MarketDeepAnalysis }) {
  return (
    <div className="flex flex-col gap-2">
      <Caption className="font-medium uppercase tracking-wide">Product → Country market analysis</Caption>
      <PageTitle className="break-words">{a.product.displayName} → {a.country.name}</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <CodeLabel code={a.product.classificationCode} codeSystem={a.product.codeSystem} />
        <Badge variant="neutral">{a.country.region} · {a.country.currency}</Badge>
        <ContextBadges context={a.context} />
        {a.match.level === "HS_HEADING" && <Badge variant="warning">Matched at heading level ({formatTariffCode(a.match.matchedCode)})</Badge>}
      </div>
      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href={`/compare/markets?product=${a.product.id}&countries=${a.country.code}`}>Compare this market</Link>
      </Button>
    </div>
  );
}

function Summary({ a }: { a: MarketDeepAnalysis }) {
  return (
    <section aria-labelledby="summary-h" className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle id="summary-h" className="text-base">Market Opportunity {a.provenance?.score && <ProvenanceBadge p={a.provenance.score} className="ml-2 align-middle" />}</SectionTitle>
        <div className="flex flex-wrap items-end gap-4">
          <div><p className="text-4xl font-semibold">{a.opportunityScore}<span className="text-base font-normal text-muted-foreground">/100</span></p><Caption>Opportunity score</Caption></div>
          <div><p className="text-2xl font-semibold">{a.confidence}<span className="text-sm font-normal text-muted-foreground">/100</span></p><Caption>Data confidence</Caption></div>
          {a.personalFit && <div><p className="text-2xl font-semibold">{a.personalFit.score}<span className="text-sm font-normal text-muted-foreground">/100</span></p><Caption>Personal fit</Caption></div>}
        </div>
        <HelperText>
          {a.scoreChange.previousScore === null
            ? a.scoreChange.reasons[0]
            : `Previous ${a.scoreChange.previousScore} (${a.scoreChange.delta! >= 0 ? "+" : ""}${a.scoreChange.delta}). ${a.scoreChange.reasons.join("; ")}`}
        </HelperText>
        {a.discovery && (
          <HelperText>
            Opportunity discovery score: <Link className="text-primary hover:underline" href={`/opportunities/${a.discovery.opportunityId}`}>{a.discovery.overallScore}/100</Link> (lighter screening score, shown for reference).
          </HelperText>
        )}
        {a.productIntelligence && (
          <HelperText>
            Product-level intelligence: <Link className="text-primary hover:underline" href={`/products/${a.product.id}/intelligence`}>{a.productIntelligence.opportunityScore}/100</Link>
            {a.productIntelligence.indiaExportSharePercent !== null && ` · ${a.country.name} takes ${a.productIntelligence.indiaExportSharePercent}% of India's exports of this product`}.
          </HelperText>
        )}
        <details className="text-xs">
          <summary className="w-fit cursor-pointer rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How the score is calculated</summary>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">Market score components</caption>
            <thead><tr className="text-muted-foreground"><th scope="col" className="py-1 font-medium">Component</th><th scope="col" className="py-1 text-right font-medium">Weight</th><th scope="col" className="py-1 text-right font-medium">Score</th></tr></thead>
            <tbody>
              {a.components.map((c) => (
                <tr key={c.key} className="border-t border-border"><td className="py-1">{c.label}</td><td className="py-1 text-right">{c.weight}%</td><td className="py-1 text-right">{c.score}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ListCard title="Why this market" items={a.reasons} icon="good" empty="No standout strengths in the data." />
        <ListCard title="Risks" items={a.risks} icon="risk" empty="No major risks flagged." />
        {a.personalFit && (
          <Card className="p-4 md:col-span-2">
            <h3 className="text-sm font-semibold">Personal fit ({a.personalFit.score}/100)</h3>
            {a.personalFit.reasons.length ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm">{a.personalFit.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
            ) : (
              <HelperText className="mt-1">No specific signals from your profile.</HelperText>
            )}
            <HelperText className="mt-2">From your exporter profile — does not change the market score.</HelperText>
          </Card>
        )}
      </div>
    </section>
  );
}

function ListCard({ title, items, icon, empty }: { title: string; items: string[]; icon: "good" | "risk"; empty: string }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((t) => (
            <li key={t} className="flex items-start gap-2 text-sm">
              {icon === "good" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />}
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <HelperText className="mt-2">{empty}</HelperText>
      )}
    </Card>
  );
}

function DemandSection({ a }: { a: MarketDeepAnalysis }) {
  const money = (v: number) => formatMoney(v, a.marketSize.currency);
  const t = a.importTrend;
  const demand = a.components.find((c) => c.key === "demand")!;
  return (
    <section aria-labelledby="demand-h" className="flex flex-col gap-4">
      <SectionTitle id="demand-h">Demand &amp; Imports {a.provenance?.marketSize && <ProvenanceBadge p={a.provenance.marketSize} className="ml-2 align-middle" />}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Market size (${a.marketSize.period})`} value={a.marketSize.available ? money(a.marketSize.importValue!) : "Unavailable"} sub={`${a.country.name} total imports`} />
        <Stat label="Import quantity" value={a.marketSize.importQuantity !== null ? formatQuantity(a.marketSize.importQuantity, a.marketSize.quantityUnit) : "Unavailable"} sub={a.marketSize.importQuantity === null ? "No comparable quantity data" : undefined} />
        <Stat label="Import CAGR" value={t.cagr.available ? formatPercent(t.cagr.valuePercent) : "Unavailable"} sub={t.cagr.available ? `${t.cagr.fromPeriod}–${t.cagr.toPeriod}` : t.cagr.reason ?? undefined} />
        <Stat label="Demand score" value={`${demand.score}/100`} sub={<>Latest YoY <Growth value={t.latestYoyPercent} /></>} />
      </div>
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Import trend</h3>
        <HelperText className="mb-3">Yearly imports by {a.country.name}, {a.marketSize.currency}. Monthly data is not available in this dataset.</HelperText>
        <TrendChart
          points={t.yearly.map((p) => ({ label: p.period, value: p.exportValue }))}
          formatValue={money}
          summary={`${a.country.name} imports: ${t.yearly.map((p) => `${p.period} ${p.exportValue === null ? "n/a" : money(p.exportValue)}`).join(", ")}`}
          tableCaption="Imports by year"
          valueHeader={`Imports (${a.marketSize.currency})`}
        />
      </Card>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card className="p-3">
      <Caption>{label}</Caption>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function IndiaAndCompetition({ a }: { a: MarketDeepAnalysis }) {
  const ip = a.indiaPosition;
  const c = a.competition;
  return (
    <section aria-labelledby="comp-h" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <SectionTitle id="india-h" className="text-base">India Position {a.provenance?.indiaPosition && <ProvenanceBadge p={a.provenance.indiaPosition} className="ml-2 align-middle" />}</SectionTitle>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <Meta label="India's share of imports" value={`${ip.sharePercent}%`} />
          <Meta label="India's supplier rank" value={ip.rank ? `#${ip.rank}` : "—"} />
          <div><dt className="text-xs text-muted-foreground">Share change vs last year</dt><dd>{ip.shareChangePoints === null ? "—" : `${ip.shareChangePoints > 0 ? "+" : ""}${ip.shareChangePoints} pts`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Presence</dt><dd><Badge variant={ip.presenceLevel === "HIGH" ? "success" : ip.presenceLevel === "MODERATE" ? "warning" : "danger"}>{titleCase(ip.presenceLevel)} India presence</Badge></dd></div>
        </dl>
      </Card>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle id="comp-h" className="text-base">Competition {a.provenance?.competition && <ProvenanceBadge p={a.provenance.competition} className="ml-2 align-middle" />}</SectionTitle>
          <Badge variant={riskVariant(c.level)}>{titleCase(c.level)} competition</Badge>
          <ScorePill score={c.score} label="Attractiveness" />
        </div>
        <p className="mt-2 text-sm">{c.explanation}</p>
        <HelperText className="mb-3">{c.majorSupplierCount} major supplier countries (≥10%) · supplier HHI {c.supplierHhi.toLocaleString()} (sum of squared shares)</HelperText>
        <ShareList
          caption="Competing supplier countries"
          items={c.suppliers.map((s) => ({
            key: s.countryCode,
            rank: s.rank,
            label: countryLabel(s.countryCode),
            share: s.sharePercent,
            extra: <>{formatMoney(s.indicativeValue, a.marketSize.currency)} <Growth value={s.growthPercent} /></>,
          }))}
        />
      </Card>
    </section>
  );
}

function TariffSection({ a }: { a: MarketDeepAnalysis }) {
  const t = a.tariff;
  return (
    <section aria-labelledby="tariff-h" className="flex flex-col gap-4">
      <SectionTitle id="tariff-h">Tariffs &amp; Trade Barriers {a.provenance?.tariff && <ProvenanceBadge p={a.provenance.tariff} className="ml-2 align-middle" />}</SectionTitle>
      <RegulatoryNotice text={a.regulatoryNotice} isSample={a.source.isSample} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Tariff</h3>
          {t.available ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <Meta label="Applied rate (sample)" value={`${t.appliedRatePercent}%`} />
                <Meta label="Preferential rate (sample)" value={t.preferentialRatePercent === null ? "None in dataset" : `${t.preferentialRatePercent}%`} />
                <Meta label="Preferential scheme" value={t.preferentialScheme ?? "—"} />
                <Meta label="Tariff type" value={t.tariffType ?? "—"} />
                <Meta label="Effective date" value={t.effectiveDate ? new Date(t.effectiveDate).toLocaleDateString() : "—"} />
                <Meta label="Verification" value={VERIFICATION_LABELS[t.verification]} />
              </dl>
              <p className="mt-3 text-xs font-medium text-warning">{t.note}</p>
            </>
          ) : (
            <EmptyState title="Tariff data unavailable" description={t.note} className="mt-3 p-6" />
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Trade barrier signals (informational)</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {a.barriers.map((b) => (
              <li key={b.type + b.label} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{b.label}</span>
                  <Badge variant={riskVariant(b.level)}>{titleCase(b.level)}</Badge>
                  <Caption>{VERIFICATION_LABELS[b.verification]}</Caption>
                </span>
                <span className="text-xs text-muted-foreground">{b.note}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

function GuidanceSection({ a }: { a: MarketDeepAnalysis }) {
  const p = a.pricing;
  return (
    <section aria-labelledby="guide-h" className="flex flex-col gap-4">
      <SectionTitle id="guide-h">Commercial Guidance {a.provenance?.guidance && <ProvenanceBadge p={a.provenance.guidance} className="ml-2 align-middle" />}</SectionTitle>
      <HelperText>Sample guidance — informational only. &quot;Common practice&quot; describes typical trade behaviour; &quot;possible requirement&quot; must be verified for your exact product and buyer.</HelperText>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Pricing benchmark</h3>
          {p.available ? (
            <>
              <p className="mt-2 text-2xl font-semibold">{p.unitValue} <span className="text-sm font-normal text-muted-foreground">{p.unit}</span></p>
              <p className="text-xs text-muted-foreground">Previous year {p.previousUnitValue} {p.unit} · <Growth value={p.changePercent} /></p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Unavailable</p>
          )}
          <p className="mt-2 text-xs text-foreground">{p.note}</p>
        </Card>
        <GuideCard title="Packaging" items={a.packaging} />
        <GuideCard title="Labeling" items={a.labeling} />
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Certifications</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {a.certifications.map((c) => (
              <li key={c.name} className="flex flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.name}</span><Badge variant="neutral">{CERT_STATUS[c.status]}</Badge></span>
                <span className="text-xs text-muted-foreground">{c.note} · {VERIFICATION_LABELS[c.verification]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

function GuideCard({ title, items }: { title: string; items: MarketDeepAnalysis["packaging"] }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((g) => (
          <li key={g.text} className="flex flex-col gap-0.5 text-sm">
            <span>{g.text}</span>
            <span className="flex gap-2">
              <Badge variant={g.kind === "COMMON_PRACTICE" ? "neutral" : "warning"}>{g.kind === "COMMON_PRACTICE" ? "Common practice" : "Possible requirement — verify"}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LogisticsAndRisk({ a }: { a: MarketDeepAnalysis }) {
  const l = a.logistics;
  const r = a.risk;
  const e = a.marketEntry;
  return (
    <section aria-labelledby="risk-h" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2"><SectionTitle id="log-h" className="text-base">Logistics {a.provenance?.logistics && <ProvenanceBadge p={a.provenance.logistics} className="ml-2 align-middle" />}</SectionTitle><ScorePill score={l.score} /></div>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <Meta label="Likely destination ports" value={l.destinationPorts.join(", ")} />
          <Meta label="Sea transit (indicative)" value={l.seaTransit} />
          <Meta label="Air suitability" value={l.airSuitability} />
          <div><dt className="text-xs text-muted-foreground">Route complexity</dt><dd><Badge variant={riskVariant(l.routeComplexity)}>{titleCase(l.routeComplexity)}</Badge></dd></div>
        </dl>
        {l.notes.map((n) => <HelperText key={n} className="mt-2">{n}</HelperText>)}
        <HelperText className="mt-2">No freight quotation — indicative suitability only.</HelperText>
      </Card>
      <Card className="p-4">
        <SectionTitle id="risk-h" className="text-base">Country &amp; Currency Risk {a.provenance?.risk && <ProvenanceBadge p={a.provenance.risk} className="ml-2 align-middle" />}</SectionTitle>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Country risk</dt><dd><Badge variant={riskVariant(r.countryRiskLevel)}>{titleCase(r.countryRiskLevel)} risk</Badge> <span className="text-xs">{r.countryRiskScore}/100</span></dd></div>
          <div><dt className="text-xs text-muted-foreground">Currency ({r.currency})</dt><dd><Badge variant={riskVariant(r.currencyRiskLevel)}>{titleCase(r.currencyRiskLevel)} risk</Badge> <span className="text-xs">stability {r.currencyStabilityScore}/100</span></dd></div>
        </dl>
        {r.notes.map((n) => <HelperText key={n} className="mt-2">{n}</HelperText>)}
      </Card>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle id="entry-h" className="text-base">Market-entry difficulty</SectionTitle>
          <Badge variant={riskVariant(e.difficulty)}>{titleCase(e.difficulty)}</Badge>
        </div>
        <p className="mt-2 text-sm">Ease score {e.easeScore}/100</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">{e.reasons.map((x) => <li key={x}>• {x}</li>)}</ul>
        <HelperText className="mt-2">Composite of tariff, barrier signals, competition, logistics, country risk and India presence.</HelperText>
      </Card>
    </section>
  );
}
