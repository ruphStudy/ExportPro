"use client";

import { SUPPLIER_PAYMENT_TRIGGERS } from "@exportpro/types";
import { words } from "@/components/procurement/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Caption } from "@/components/ui/typography";

export type ScheduleRow = { label: string; percentage: string; trigger: string; dueDays: string; fixedDate?: string };

/** Supplier payment schedule (e.g. 30% advance, 70% on delivery). Percentages must total 100 — splits are never guessed. */
export function ScheduleEditor({ rows, onChange }: { rows: ScheduleRow[]; onChange: (r: ScheduleRow[]) => void }) {
  const sum = rows.reduce((t, r) => t + (Number(r.percentage) || 0), 0);
  const upd = (i: number, k: keyof ScheduleRow, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Supplier payment schedule</legend>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_10rem_6rem_auto]">
          <Input aria-label={`Installment ${i + 1} label`} value={r.label} onChange={(e) => upd(i, "label", e.target.value)} />
          <Input aria-label={`Installment ${i + 1} percent`} inputMode="decimal" value={r.percentage} onChange={(e) => upd(i, "percentage", e.target.value)} />
          <Select aria-label={`Installment ${i + 1} trigger`} value={r.trigger} onChange={(e) => upd(i, "trigger", e.target.value)} options={SUPPLIER_PAYMENT_TRIGGERS.map((t) => ({ value: t, label: words(t) }))} />
          {r.trigger === "FIXED_DATE" ? (
            <Input aria-label={`Installment ${i + 1} date`} type="date" value={r.fixedDate ?? ""} onChange={(e) => upd(i, "fixedDate", e.target.value)} />
          ) : (
            <Input aria-label={`Installment ${i + 1} days after`} inputMode="numeric" placeholder="+days" value={r.dueDays} onChange={(e) => upd(i, "dueDays", e.target.value)} />
          )}
          <Button type="button" size="sm" variant="ghost" aria-label={`Remove installment ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...rows, { label: "Payment", percentage: "", trigger: "CREDIT_DAYS", dueDays: "30" }])}>Add installment</Button>
        <Caption className={sum === 100 ? "" : "text-danger"}>Total {sum}%{sum !== 100 ? " — must be 100%" : ""}</Caption>
      </div>
    </fieldset>
  );
}

export const scheduleBody = (rows: ScheduleRow[]) => rows.map((s) => ({ label: s.label, percentage: s.percentage || null, trigger: s.trigger, dueDays: s.dueDays ? Number(s.dueDays) : null, fixedDate: s.trigger === "FIXED_DATE" ? s.fixedDate || null : null }));
