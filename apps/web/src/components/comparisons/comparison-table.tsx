import { ArrowDown, ArrowUp, CheckCircle2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { ComparisonMetric, ComparisonRow, ComparisonSummary } from "@exportpro/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { HelperText, SectionTitle } from "@/components/ui/typography";

export interface ComparisonColumn {
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  metrics: ComparisonMetric[];
  /** Shown instead of metrics for unsupported / partial items. */
  unavailableMessage?: string | null;
}

/**
 * Items as columns, metrics as rows. Best / lowest values are marked with
 * an icon and text (not color alone). On narrow screens the table scrolls
 * inside its container with the metric column pinned.
 */
export function ComparisonTable({ caption, columns, rows }: { caption: string; columns: ComparisonColumn[]; rows: ComparisonRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-[9rem] bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Metric
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className="min-w-[10rem] px-3 py-2 text-left align-top">
                <span className="block font-semibold text-foreground">{c.title}</span>
                {c.subtitle && <span className="block text-xs font-normal text-muted-foreground">{c.subtitle}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left align-top font-medium text-foreground">
                {r.label}
                <span className="block text-[11px] font-normal text-muted-foreground">{r.description}</span>
              </th>
              {columns.map((c) => {
                if (c.unavailableMessage) {
                  return (
                    <td key={c.id} className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {r.key === rows[0].key ? c.unavailableMessage : "—"}
                    </td>
                  );
                }
                const m = c.metrics.find((x) => x.key === r.key);
                const best = r.bestIds.includes(c.id);
                const worst = r.worstIds.includes(c.id);
                return (
                  <td key={c.id} className={cn("px-3 py-2 align-top", best && "bg-success/5", worst && "bg-danger/5")}>
                    {m?.score === null || m === undefined ? (
                      <span className="text-xs text-muted-foreground">{m?.label ?? "Unavailable"}</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-foreground">{m.score}<span className="text-xs font-normal text-muted-foreground">/100</span></span>
                        {m.label !== `${m.score}/100` && <span className="text-xs text-muted-foreground">{m.label}</span>}
                      </div>
                    )}
                    {best && (
                      <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-success">
                        <ArrowUp className="size-3" aria-hidden="true" /> Highest
                      </span>
                    )}
                    {worst && (
                      <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-danger">
                        <ArrowDown className="size-3" aria-hidden="true" /> Lowest
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonSummaryCard({ summary }: { summary: ComparisonSummary }) {
  if (!summary.headline) return <HelperText>{summary.note}</HelperText>;
  return (
    <Card className="flex flex-col gap-3 p-4" aria-live="polite">
      <SectionTitle className="text-base">{summary.headline}</SectionTitle>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Why</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.reasons.length ? summary.reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />{r}</li>
            )) : <li className="text-sm text-muted-foreground">Leads on the overall score rather than any single metric.</li>}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Trade-offs</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.tradeOffs.length ? summary.tradeOffs.map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />{r}</li>
            )) : <li className="text-sm text-muted-foreground">No notable trade-offs in the compared metrics.</li>}
          </ul>
        </div>
      </div>
      <HelperText>{summary.note}</HelperText>
    </Card>
  );
}

/** Compact grouped bars for a few key dimensions — decorative; the table above is the accessible representation. */
export function ComparisonBars({ columns, dims }: { columns: ComparisonColumn[]; dims: { key: string; label: string }[] }) {
  const shades = ["bg-primary", "bg-primary/75", "bg-primary/55", "bg-primary/40", "bg-primary/25"];
  const usable = columns.filter((c) => !c.unavailableMessage);
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">At a glance</h3>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs" aria-hidden="true">
        {usable.map((c, i) => (
          <li key={c.id} className="flex items-center gap-1"><span className={cn("inline-block size-2.5 rounded-sm", shades[i])} />{c.title}</li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {dims.map((d) => (
          <div key={d.key}>
            <p className="text-xs font-medium text-foreground">{d.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {usable.map((c, i) => {
                const v = c.metrics.find((m) => m.key === d.key)?.score ?? null;
                return (
                  <div key={c.id} className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-muted">
                      {v !== null && <div className={cn("h-2 rounded-full", shades[i])} style={{ width: `${v}%` }} />}
                    </div>
                    <span className="w-8 text-right text-[11px] text-muted-foreground">{v ?? "n/a"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="sr-only">Bar chart summary of the comparison table above; see the table for exact values.</p>
    </Card>
  );
}

export function ProfileNote({ missing }: { missing: string[] }) {
  return (
    <HelperText>
      {missing.length > 0 && (
        <>
          Personal fit uses neutral values for missing profile inputs: {missing.join(", ")}.{" "}
          <Link href="/export-setup" className="text-primary hover:underline">Complete Export Setup</Link>.{" "}
        </>
      )}
      <Badge variant="neutral">Export timeline isn&apos;t collected yet, so it doesn&apos;t affect fit</Badge>
    </HelperText>
  );
}
