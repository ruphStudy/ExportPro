"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { HelperText } from "@/components/ui/typography";

export interface ChartPoint {
  label: string;
  value: number | null;
}

const W = 600;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

/**
 * Hand-rolled SVG line/area or bar chart (no chart library, matching the
 * Sprint 4 radar). The chart is decorative-plus-summary for screen
 * readers; the data table below it is the accessible representation.
 */
export function TrendChart({
  points,
  kind = "area",
  formatValue,
  summary,
  tableCaption,
  valueHeader,
}: {
  points: ChartPoint[];
  kind?: "area" | "bar";
  formatValue: (v: number) => string;
  summary: string;
  tableCaption: string;
  valueHeader: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const valid = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (valid.length === 0) return <HelperText>No data for this series.</HelperText>;

  const max = Math.max(...valid.map((p) => p.value)) * 1.1 || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const barW = Math.max(4, (innerW / points.length) * 0.6);
  const x = (i: number) => (kind === "bar" ? PAD.left + (innerW / points.length) * (i + 0.5) : PAD.left + i * step);
  const yv = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const coords = points.map((p, i) => (p.value === null ? null : ([x(i), yv(p.value)] as const)));
  const line = coords.filter(Boolean).map((c, i) => `${i === 0 ? "M" : "L"}${c![0]},${c![1]}`).join(" ");
  const firstX = coords.find(Boolean)![0];
  const lastX = [...coords].reverse().find(Boolean)![0];
  const area = `${line} L${lastX},${PAD.top + innerH} L${firstX},${PAD.top + innerH} Z`;
  const ticks = [0, 0.5, 1].map((t) => max * t);
  const labelEvery = Math.ceil(points.length / 8);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yv(t)} y2={yv(t)} className="stroke-border" strokeDasharray="3 3" />
              <text x={PAD.left - 6} y={yv(t) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
                {formatValue(t)}
              </text>
            </g>
          ))}
          {kind === "area" ? (
            <>
              <path d={area} className="fill-primary/10" />
              <path d={line} className="fill-none stroke-primary" strokeWidth={2} />
            </>
          ) : null}
          {points.map((p, i) =>
            p.value === null ? null : kind === "bar" ? (
              <rect
                key={p.label}
                x={x(i) - barW / 2}
                y={yv(p.value)}
                width={barW}
                height={PAD.top + innerH - yv(p.value)}
                rx={2}
                className={cn("fill-primary/70", active === i && "fill-primary")}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            ) : (
              <circle
                key={p.label}
                cx={x(i)}
                cy={yv(p.value)}
                r={active === i ? 5 : 3.5}
                className="fill-surface stroke-primary"
                strokeWidth={2}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            ),
          )}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text key={`l-${p.label}`} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {p.label}
              </text>
            ) : null,
          )}
        </svg>
        {active !== null && points[active].value !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm"
            style={{ left: `${(x(active) / W) * 100}%`, transform: "translateX(-50%)" }}
          >
            <span className="font-medium text-foreground">{points[active].label}</span>{" "}
            <span className="text-muted-foreground">{formatValue(points[active].value!)}</span>
          </div>
        )}
      </div>
      <details className="text-xs">
        <summary className="w-fit cursor-pointer rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          View data table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{tableCaption}</caption>
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium text-muted-foreground">Period</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium text-muted-foreground">{valueHeader}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label} className="border-t border-border">
                  <td className="px-3 py-1.5 text-foreground">{p.label}</td>
                  <td className="px-3 py-1.5 text-right text-foreground">{p.value === null ? "Not available" : formatValue(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Ranked share list with simple bars — clearer than a chart for states/ports/destinations. */
export function ShareList({
  items,
  caption,
}: {
  items: { key: string; rank: number; label: string; sublabel?: string; share: number; extra?: React.ReactNode }[];
  caption: string;
}) {
  return (
    <ol aria-label={caption} className="flex flex-col gap-2.5">
      {items.map((it) => (
        <li key={it.key} className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
            <span className="min-w-0 break-words text-foreground">
              <span className="mr-1.5 text-xs text-muted-foreground">#{it.rank}</span>
              {it.label}
              {it.sublabel && <span className="ml-1.5 text-xs text-muted-foreground">{it.sublabel}</span>}
            </span>
            <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
              {it.extra}
              <span className="font-medium text-foreground">{it.share}%</span>
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden="true">
            <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.min(100, it.share)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
