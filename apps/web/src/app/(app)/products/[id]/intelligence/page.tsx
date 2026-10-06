"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Info, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import {
  countryLabel,
  formatTariffCode,
  type ProductIntelligence,
  type RiskSignal,
  type TrendPeriodOption,
} from "@exportpro/types";
import { formatMoney, formatPercent, formatQuantity, productIntelligenceApi } from "@/lib/api/product-intelligence";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { FRESHNESS_LABELS, SOURCE_TYPE_LABELS } from "@/lib/opportunity-labels";
import { CLASSIFICATION_STATUS_LABELS } from "@/lib/product-labels";
import { cn } from "@/lib/utils";
import { RequirePermission } from "@/components/layout/require-permission";
import { ShareList, TrendChart } from "@/components/product-intelligence/trend-chart";
import { CodeLabel } from "@/components/products/classification-bits";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

type Variant = NonNullable<BadgeProps["variant"]>;
const scoreVariant = (score: number): Variant => (score >= 67 ? "success" : score >= 40 ? "warning" : "danger");
const levelText = (l: string) => l.charAt(0) + l.slice(1).toLowerCase();

export default function ProductIntelligencePage() {
  return (
    <RequirePermission permission="product_intelligence.view">
      <IntelligenceContent />
    </RequirePermission>
  );
}

function IntelligenceContent() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["product-intelligence", id], queryFn: () => productIntelligenceApi.get(id) });

  if (query.isLoading) return <IntelligenceSkeleton />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="Product intelligence couldn't load"
        message={toFriendlyErrorMessage(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }
  const data = query.data;
  const crumbs = [
    { label: "Products", href: "/products" },
    { label: data.product.displayName, href: `/products/${data.product.id}` },
    { label: "Intelligence" },
  ];

  if (data.status !== "AVAILABLE") {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={crumbs} />
        <PageTitle className="break-words">{data.product.displayName}</PageTitle>
        <EmptyState
          icon={data.status === "CLASSIFICATION_REQUIRED" ? ShieldAlert : Database}
          title={data.status === "CLASSIFICATION_REQUIRED" ? "Classification confirmation required" : "No trade intelligence yet"}
          description={data.message}
          action={
            <Button asChild variant="outline">
              <Link href={`/products/${data.product.id}`}>Back to product</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const intel = data;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Breadcrumbs items={crumbs} />
      <Header intel={intel} />
      <SourcePanel intel={intel} />
      <OpportunitySummary intel={intel} />
      <TrendSection intel={intel} />
      <SeasonalitySection intel={intel} />
      <EcosystemSection intel={intel} />
      <MarketsSection intel={intel} />
      <RiskSection intel={intel} />
    </div>
  );
}

function IntelligenceSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading product intelligence">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function Header({ intel }: { intel: ProductIntelligence }) {
  const p = intel.product;
  const status = CLASSIFICATION_STATUS_LABELS[p.classificationStatus];
  return (
    <div className="flex flex-col gap-2">
      <Caption className="font-medium uppercase tracking-wide">Product Intelligence</Caption>
      <PageTitle className="break-words">{p.displayName}</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <CodeLabel code={p.classificationCode} codeSystem={p.codeSystem} />
        <Badge variant={status.variant}>{status.label}</Badge>
        {intel.match.level === "HS_HEADING" && (
          <Badge variant="warning">Matched at heading level ({formatTariffCode(intel.match.matchedCode)})</Badge>
        )}
      </div>
      <HelperText>
        Trade data for: {intel.match.datasetLabel} ({formatTariffCode(intel.match.matchedCode)})
      </HelperText>
    </div>
  );
}

function SourcePanel({ intel }: { intel: ProductIntelligence }) {
  const s = intel.source;
  const fresh = FRESHNESS_LABELS[s.freshness];
  return (
    <section aria-labelledby="source-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 id="source-heading" className="sr-only">Data source</h2>
      {s.isSample && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm font-medium text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Sample trade intelligence — not official government statistics.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Meta label="Source type" value={SOURCE_TYPE_LABELS[s.sourceType]} />
        <Meta label="Source" value={s.sourceName} className="col-span-2 sm:col-span-1 lg:col-span-2" />
        <Meta label="Period" value={`${s.coverageFrom}–${s.coverageTo}`} />
        <Meta label="Data date" value={new Date(s.sourceDate).toLocaleDateString()} />
        <Meta label="Last updated" value={new Date(s.lastUpdatedAt).toLocaleDateString()} />
        <div>
          <dt className="text-xs text-muted-foreground">Freshness</dt>
          <dd><Badge variant={fresh.variant}>{fresh.label}</Badge></dd>
        </div>
        <Meta label="Data confidence" value={`${intel.confidence}/100`} />
        <Meta label="Dataset version" value={s.datasetVersion} />
      </dl>
    </section>
  );
}

function Meta({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function OpportunitySummary({ intel }: { intel: ProductIntelligence }) {
  const o = intel.opportunity;
  return (
    <section aria-labelledby="summary-heading" className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle id="summary-heading" className="text-base">Product Opportunity</SectionTitle>
        <div className="flex items-end gap-4">
          <div>
            <p className="text-4xl font-semibold text-foreground">{o.score}<span className="text-base font-normal text-muted-foreground">/100</span></p>
            <Caption>Opportunity score</Caption>
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground">{intel.confidence}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
            <Caption>Data confidence</Caption>
          </div>
        </div>
        <HelperText>
          Overall attractiveness of exporting this product from India across markets. Confidence reflects data quality, not attractiveness.
        </HelperText>
        <details className="text-xs">
          <summary className="w-fit cursor-pointer rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            How the score is calculated
          </summary>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">Opportunity score components</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 font-medium">Component</th>
                <th scope="col" className="py-1 text-right font-medium">Weight</th>
                <th scope="col" className="py-1 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {o.components.map((c) => (
                <tr key={c.key} className="border-t border-border">
                  <td className="py-1 text-foreground">{c.label}</td>
                  <td className="py-1 text-right text-foreground">{c.weight}%</td>
                  <td className="py-1 text-right text-foreground">{c.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Strengths</h3>
          {o.strengths.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {o.strengths.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <HelperText className="mt-2">No standout strengths in the data.</HelperText>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Risks</h3>
          {o.risks.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {o.risks.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <HelperText className="mt-2">No major risks flagged by the data.</HelperText>
          )}
        </Card>
        {intel.personalFit.length > 0 && (
          <Card className="p-4 md:col-span-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Info className="size-4 text-info" aria-hidden="true" />
              Personal fit (from your exporter profile)
            </h3>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-foreground">
              {intel.personalFit.map((n) => <li key={n}>• {n}</li>)}
            </ul>
            <HelperText className="mt-2">Contextual only — this does not change the product&apos;s score.</HelperText>
          </Card>
        )}
      </div>
    </section>
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

function TrendSection({ intel }: { intel: ProductIntelligence }) {
  const t = intel.trend;
  const hasMonthly = t.monthly.length > 0;
  const [resolution, setResolution] = React.useState<"yearly" | "monthly">("yearly");
  const [periodKey, setPeriodKey] = React.useState<TrendPeriodOption["key"]>(t.periodOptions[t.periodOptions.length - 1]?.key ?? "ALL");
  const period = t.periodOptions.find((o) => o.key === periodKey) ?? null;
  const series = resolution === "monthly" ? t.monthly : t.yearly.filter((p) => !period || p.period >= period.fromPeriod);
  const cagrShown = period?.cagr ?? t.cagr;
  const money = (v: number) => formatMoney(v, t.currency);

  return (
    <section aria-labelledby="trend-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle id="trend-heading">Export Trend</SectionTitle>
          <HelperText>Values in {t.currency} as reported by the source (not converted). Confidence {t.confidence}/100.</HelperText>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasMonthly && (
            <Toggle
              label="Resolution"
              value={resolution}
              options={[{ value: "yearly", label: "Yearly" }, { value: "monthly", label: "Monthly" }]}
              onChange={(v) => setResolution(v as "yearly" | "monthly")}
            />
          )}
          {resolution === "yearly" && t.periodOptions.length > 1 && (
            <Toggle
              label="Period"
              value={periodKey}
              options={t.periodOptions.map((o) => ({ value: o.key, label: o.key === "ALL" ? `${o.fromPeriod}–${o.toPeriod}` : o.key }))}
              onChange={(v) => setPeriodKey(v as TrendPeriodOption["key"])}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Export value (${t.value.latestPeriod})`} value={money(t.value.latestValue)} sub={<Growth value={t.value.yoyGrowthPercent} />} subLabel="YoY" />
        <Stat
          label={`Export quantity (${t.value.latestPeriod})`}
          value={t.quantity.available ? formatQuantity(t.quantity.latestValue, t.quantity.unit) : "Unavailable"}
          sub={t.quantity.available ? <Growth value={t.quantity.yoyGrowthPercent} /> : undefined}
          subLabel={t.quantity.available ? "YoY" : "Insufficient / incompatible quantity data"}
        />
        <Stat
          label="CAGR"
          value={cagrShown.available ? formatPercent(cagrShown.valuePercent) : "Unavailable"}
          subLabel={cagrShown.available ? `${cagrShown.fromPeriod}–${cagrShown.toPeriod} (${cagrShown.years} yrs)` : cagrShown.reason ?? undefined}
        />
        <Stat label="Previous year value" value={formatMoney(t.value.previousValue, t.currency)} subLabel={t.yearly.at(-2)?.period} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Export Value Trend</h3>
          <HelperText className="mb-3">{resolution === "monthly" ? "Monthly" : "Yearly"} export value, {t.currency}. Source: {intel.source.sourceName}.</HelperText>
          <TrendChart
            points={series.map((p) => ({ label: p.period, value: p.exportValue }))}
            formatValue={money}
            summary={`Export value from ${series[0]?.period} to ${series.at(-1)?.period}: ${series.map((p) => `${p.period} ${p.exportValue === null ? "n/a" : money(p.exportValue)}`).join(", ")}`}
            tableCaption="Export value by period"
            valueHeader={`Value (${t.currency})`}
          />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Export Quantity Trend</h3>
          {t.quantity.available ? (
            <>
              <HelperText className="mb-3">{resolution === "monthly" ? "Monthly" : "Yearly"} quantity in {t.quantity.unit}.</HelperText>
              <TrendChart
                kind="bar"
                points={series.map((p) => ({ label: p.period, value: p.exportQuantity }))}
                formatValue={(v) => formatQuantity(v, t.quantity.unit)}
                summary={`Export quantity: ${series.map((p) => `${p.period} ${formatQuantity(p.exportQuantity, t.quantity.unit)}`).join(", ")}`}
                tableCaption="Export quantity by period"
                valueHeader={`Quantity (${t.quantity.unit})`}
              />
            </>
          ) : (
            <EmptyState
              title="Quantity data unavailable"
              description="This dataset reports quantities in incompatible units or not at all, so no quantity trend is shown."
              className="mt-3 p-6"
            />
          )}
        </Card>
      </div>

      {resolution === "yearly" && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max text-sm">
            <caption className="sr-only">Year-over-year growth</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Year</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Value</th>
                {t.quantity.available && <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>}
                <th scope="col" className="px-3 py-2 text-right font-medium">YoY growth</th>
              </tr>
            </thead>
            <tbody>
              {t.yearly.map((p) => (
                <tr key={p.period} className="border-t border-border">
                  <td className="px-3 py-2">{p.period}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(p.exportValue, t.currency)}</td>
                  {t.quantity.available && <td className="px-3 py-2 text-right">{formatQuantity(p.exportQuantity, t.quantity.unit)}</td>}
                  <td className="px-3 py-2 text-right"><Growth value={p.growthPercent} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Toggle({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "cursor-pointer rounded px-2.5 py-1 text-xs focus-within:ring-2 focus-within:ring-ring",
            value === o.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
          )}
        >
          <input type="radio" name={label} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, subLabel }: { label: string; value: string; sub?: React.ReactNode; subLabel?: string }) {
  return (
    <Card className="p-3">
      <Caption>{label}</Caption>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {sub}
        {subLabel && <span>{subLabel}</span>}
      </p>
    </Card>
  );
}

function SeasonalitySection({ intel }: { intel: ProductIntelligence }) {
  const s = intel.seasonality;
  return (
    <section aria-labelledby="season-heading">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle id="season-heading" className="text-base">Seasonality</SectionTitle>
          {s.available && s.level ? (
            <Badge variant={s.level === "LOW" ? "success" : s.level === "MODERATE" ? "warning" : "danger"}>{levelText(s.level)} seasonality</Badge>
          ) : (
            <Badge variant="neutral">Not assessed</Badge>
          )}
          {s.available && <Caption>Confidence {s.confidence}/100 · {s.monthsOfData} months of data</Caption>}
        </div>
        <p className="mt-2 text-sm text-foreground">{s.explanation}</p>
        {s.available && (
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Peak export period" value={s.strongestQuarter ?? "—"} />
            <Meta label="Weakest period" value={s.weakestQuarter ?? "—"} />
            <Meta label="Strongest months" value={s.strongestMonths.join(", ")} />
            <Meta label="Weakest months" value={s.weakestMonths.join(", ")} />
          </dl>
        )}
      </Card>
    </section>
  );
}

function EcosystemSection({ intel }: { intel: ProductIntelligence }) {
  const e = intel.ecosystem;
  const money = (v: number | null) => formatMoney(v, intel.trend.currency);
  return (
    <section aria-labelledby="eco-heading" className="flex flex-col gap-4">
      <div>
        <SectionTitle id="eco-heading">India Export Ecosystem</SectionTitle>
        <HelperText>
          Where in India this product is supplied and shipped from. Values are indicative (share × national total). Confidence {e.confidence}/100.
        </HelperText>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Major exporting states</h3>
          <HelperText className="mb-3">
            Top 2 states supply {e.stateConcentration.topTwoSharePercent}% — {levelText(e.stateConcentration.level)} concentration.
          </HelperText>
          <ShareList
            caption="Exporting states by contribution"
            items={e.states.map((s) => ({ key: s.stateCode, rank: s.rank, label: s.stateName, sublabel: s.region, share: s.contributionPercent, extra: money(s.indicativeExportValue) }))}
          />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Major export ports</h3>
          <HelperText className="mb-3">Share of export shipments by port of loading.</HelperText>
          <ShareList
            caption="Export ports by contribution"
            items={e.ports.map((p) => ({ key: p.portName, rank: p.rank, label: p.portName, sublabel: p.stateName, share: p.contributionPercent, extra: money(p.indicativeExportValue) }))}
          />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Regional contribution</h3>
          <HelperText className="mb-3">Summed from the state data above.</HelperText>
          <ShareList
            caption="Regional contribution"
            items={e.regions.map((r, i) => ({ key: r.region, rank: i + 1, label: r.region, sublabel: `${r.stateCount} state${r.stateCount === 1 ? "" : "s"}`, share: r.contributionPercent }))}
          />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Key districts</h3>
          {e.districtsAvailable ? (
            <>
              <HelperText className="mb-3">Share of national exports.</HelperText>
              <ShareList
                caption="Key districts by contribution"
                items={e.districts.map((d) => ({ key: d.district, rank: d.rank, label: d.district, sublabel: d.stateName, share: d.contributionPercent }))}
              />
            </>
          ) : (
            <EmptyState title="District-level data unavailable for this dataset." className="mt-3 p-6" />
          )}
        </Card>
      </div>
    </section>
  );
}

function MarketsSection({ intel }: { intel: ProductIntelligence }) {
  const m = intel.markets;
  return (
    <section aria-labelledby="markets-heading" className="flex flex-col gap-4">
      <div>
        <SectionTitle id="markets-heading">Major Export Markets</SectionTitle>
        <HelperText>
          Where India currently exports this product — descriptive data, not a recommendation of the best markets. Confidence {m.confidence}/100.
        </HelperText>
      </div>
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <Badge variant={m.concentration.level === "LOW" ? "success" : m.concentration.level === "MODERATE" ? "warning" : "danger"}>
          {levelText(m.concentration.level)} market concentration
        </Badge>
        <span className="text-foreground">{m.concentration.explanation}</span>
        <span className="text-muted-foreground">Top 5: {m.concentration.topFiveSharePercent}%</span>
        <span className="text-muted-foreground" title="Herfindahl–Hirschman Index: sum of squared market shares; above 2,500 is highly concentrated.">
          HHI {m.concentration.hhi.toLocaleString()} (sum of squared shares; &gt;2,500 = high)
        </span>
      </Card>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-max text-sm">
          <caption className="sr-only">Top export destinations</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Rank</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Country</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Indicative value</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Growth</th>
            </tr>
          </thead>
          <tbody>
            {m.destinations.map((d) => (
              <tr key={d.countryCode} className="border-t border-border">
                <td className="px-3 py-2">{d.rank}</td>
                <td className="px-3 py-2">{countryLabel(d.countryCode)}</td>
                <td className="px-3 py-2 text-right">{d.sharePercent}%</td>
                <td className="px-3 py-2 text-right">{formatMoney(d.indicativeExportValue, intel.trend.currency)}</td>
                <td className="px-3 py-2 text-right"><Growth value={d.growthPercent} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/products/${intel.product.id}/markets`}>Best Markets for This Product</Link>
        </Button>
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/compare/products?ids=${intel.product.id}`}>Compare with another product</Link>
        </Button>
      </div>
    </section>
  );
}

function RiskSection({ intel }: { intel: ProductIntelligence }) {
  return (
    <section aria-labelledby="risk-heading" className="flex flex-col gap-4">
      <div>
        <SectionTitle id="risk-heading">Risk Intelligence</SectionTitle>
        <HelperText>Scores are 0–100 where higher is always more favorable. Product-level signals — not country-specific rules.</HelperText>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {intel.risk.signals.map((s) => <RiskCard key={s.key} signal={s} />)}
      </div>
      <p role="note" className="text-xs text-muted-foreground">{intel.risk.indicativeMarginNote}</p>
    </section>
  );
}

function RiskCard({ signal }: { signal: RiskSignal }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{signal.label}</h3>
        <span className="text-sm font-semibold text-foreground">
          {signal.score}<span className="text-xs font-normal text-muted-foreground">/100</span>
        </span>
      </div>
      <Badge variant={scoreVariant(signal.score)} className="w-fit">{signal.status}</Badge>
      <p className="text-xs text-foreground">{signal.explanation}</p>
      <Caption>Confidence {signal.confidence}/100</Caption>
    </Card>
  );
}
