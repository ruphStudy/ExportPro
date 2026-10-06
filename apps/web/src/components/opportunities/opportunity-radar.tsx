import type { OpportunityScoreBreakdown } from "@exportpro/types";
import { Caption } from "@/components/ui/typography";

const AXES: { key: keyof OpportunityScoreBreakdown; label: string }[] = [
  { key: "demand", label: "Demand" },
  { key: "growth", label: "Growth" },
  { key: "competition", label: "Competition" },
  { key: "compliance", label: "Compliance" },
  { key: "logistics", label: "Logistics" },
  { key: "margin", label: "Margin" },
  { key: "indiaExports", label: "India Strength" },
  { key: "marketDiversity", label: "Market Diversity" },
];

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 36;

function pointFor(index: number, total: number, value: number): [number, number] {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const r = (value / 100) * RADIUS;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

/**
 * Hand-rolled SVG radar — no charting library pulled in for one shape
 * (see ARCHITECTURE.md "Opportunity Radar"). Always paired with the
 * plain-value list below it so the comparison isn't chart-only.
 */
export function OpportunityRadar({ components }: { components: OpportunityScoreBreakdown }) {
  const total = AXES.length;
  const polygonPoints = AXES.map((axis, i) => pointFor(i, total, components[axis.key]).join(",")).join(" ");
  const rings = [25, 50, 75, 100];

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label="Opportunity component radar chart"
        className="shrink-0"
      >
        {rings.map((ring) => (
          <circle
            key={ring}
            cx={CENTER}
            cy={CENTER}
            r={(ring / 100) * RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {AXES.map((axis, i) => {
          const [x, y] = pointFor(i, total, 100);
          const [lx, ly] = pointFor(i, total, 122);
          return (
            <g key={axis.key}>
              <line x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="var(--muted-foreground)">
                {axis.label}
              </text>
            </g>
          );
        })}
        <polygon points={polygonPoints} fill="var(--primary)" fillOpacity={0.25} stroke="var(--primary)" strokeWidth={2} />
        {AXES.map((axis, i) => {
          const [x, y] = pointFor(i, total, components[axis.key]);
          return <circle key={axis.key} cx={x} cy={y} r={3} fill="var(--primary)" />;
        })}
      </svg>

      <ul className="grid w-full grid-cols-2 gap-x-6 gap-y-1.5 sm:w-auto">
        {AXES.map((axis) => (
          <li key={axis.key} className="flex items-center justify-between gap-3 text-sm">
            <Caption>{axis.label}</Caption>
            <span className="font-medium text-foreground">{components[axis.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
