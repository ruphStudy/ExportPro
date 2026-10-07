"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import type { CostBasis, CostCategory, CostingLineItem, CostingScenario, ExportCostingDetail } from "@exportpro/types";
import { COST_CATEGORY_LABELS, COST_CATEGORY_ORDER, LOGISTICS_COST_CATEGORIES } from "@exportpro/types";
import { costingApi, currencyOptions, type LineInput } from "@/lib/api/costing";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { BASIS_LABELS, CONFIDENCE_LABELS, FREIGHT_QUOTE_LABELS, SOURCE_LABELS } from "@/lib/costing-labels";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { HelperText } from "@/components/ui/typography";

const AMOUNT = /^\d{1,14}(\.\d{1,6})?$/;

/** Add/edit a single cost line. Validation mirrors the API; the API remains authoritative. */
export function LineModal({ c, s, line, canEditAll, onClose }: { c: ExportCostingDetail; s: CostingScenario; line: CostingLineItem | null; canEditAll: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const policy = c.policies.find((p) => p.incoterm === s.incoterm)!;
  const [v, setV] = React.useState({
    category: (line?.category ?? (canEditAll ? "PACKAGING" : "FREIGHT")) as CostCategory,
    label: line?.label ?? "",
    notProvided: line ? line.amount === null : false,
    amount: line?.amount ?? "",
    currency: line?.currency ?? c.calculationCurrency,
    basis: (line?.basis ?? "FIXED") as CostBasis,
    percentageBase: line?.percentageBase ?? "PRE_INSURANCE_COST",
    wastagePercent: line?.wastagePercent ?? "",
    sourceType: line?.sourceType ?? "USER_ENTERED",
    confidence: line?.confidence ?? "ESTIMATE",
    freightQuoteType: line?.freightQuoteType ?? "MANUAL_ESTIMATE",
    carrier: line?.carrier ?? "",
    transitDays: line?.transitDays?.toString() ?? "",
    quoteReference: line?.quoteReference ?? "",
    quoteDate: line?.quoteDate?.slice(0, 10) ?? "",
    validUntil: line?.validUntil?.slice(0, 10) ?? "",
    routeNotes: line?.routeNotes ?? "",
    notes: line?.notes ?? "",
    includeOverride: line?.includeOverride === null || line?.includeOverride === undefined ? "" : String(line.includeOverride),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const conditional = policy.conditional.some((x) => x.category === v.category);
  const pctBasis = v.basis === "PERCENTAGE";

  const m = useMutation({
    mutationFn: (body: LineInput) => (line ? costingApi.updateLine(c.id, line.id, body) : costingApi.addLine(c.id, { ...body, scenarioId: s.id })),
    onSuccess: (d) => {
      qc.setQueryData(["costings", "detail", c.id], d);
      qc.invalidateQueries({ queryKey: ["costings", "analysis", c.id] });
      toast.success(line ? "Cost updated and recalculated" : "Cost added and recalculated");
      onClose();
    },
    onError: (e) => setErrors({ form: toFriendlyErrorMessage(e) }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!v.notProvided && !AMOUNT.test(v.amount.trim())) er.amount = "Enter a non-negative amount (use “Not provided” if unknown). Negative costs are not allowed.";
    if (pctBasis && !v.notProvided && Number(v.amount) > 100) er.amount = "A percentage cannot exceed 100%.";
    if (v.wastagePercent && !/^\d{1,2}(\.\d{1,4})?$/.test(v.wastagePercent)) er.wastagePercent = "Wastage must be between 0 and 99.9999%.";
    if (v.transitDays && !/^\d{1,3}$/.test(v.transitDays)) er.transitDays = "Whole days only.";
    if (v.quoteDate && v.validUntil && v.validUntil < v.quoteDate) er.validUntil = "Validity cannot end before the quote date.";
    setErrors(er);
    if (Object.keys(er).length) return;
    const nul = (x: string) => (x.trim() ? x.trim() : null);
    m.mutate({
      category: v.category,
      label: v.label.trim() || COST_CATEGORY_LABELS[v.category],
      amount: v.notProvided ? null : v.amount.trim(),
      currency: v.currency,
      basis: v.basis,
      percentageBase: pctBasis ? (v.percentageBase as LineInput["percentageBase"]) : null,
      wastagePercent: v.category === "PROCUREMENT" ? nul(v.wastagePercent) : null,
      sourceType: v.sourceType as LineInput["sourceType"],
      confidence: v.confidence as LineInput["confidence"],
      freightQuoteType: v.category === "FREIGHT" ? (v.freightQuoteType as LineInput["freightQuoteType"]) : null,
      carrier: v.category === "FREIGHT" ? nul(v.carrier) : null,
      transitDays: v.category === "FREIGHT" && v.transitDays ? Number(v.transitDays) : null,
      quoteReference: nul(v.quoteReference),
      quoteDate: v.quoteDate || null,
      validUntil: v.validUntil || null,
      routeNotes: nul(v.routeNotes),
      notes: nul(v.notes),
      includeOverride: conditional && v.includeOverride !== "" ? v.includeOverride === "true" : null,
      expectedRowVersion: c.rowVersion,
    });
  };

  const categories = COST_CATEGORY_ORDER.filter((cat) => canEditAll || LOGISTICS_COST_CATEGORIES.includes(cat));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={line ? `Edit cost — ${line.label}` : `Add cost to ${s.name}`} className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} noValidate>
        {(errors.form || Object.keys(errors).length > 0) && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm sm:col-span-2">
            {errors.form ?? "Please fix the highlighted fields."}
          </div>
        )}
        <Select label="Category" value={v.category} onChange={set("category")} options={categories.map((cat) => ({ value: cat, label: COST_CATEGORY_LABELS[cat] }))} disabled={Boolean(line) && !canEditAll} />
        <Input label="Label" placeholder={COST_CATEGORY_LABELS[v.category]} value={v.label} onChange={set("label")} />
        <Select label="Basis" value={v.basis} onChange={set("basis")} options={Object.entries(BASIS_LABELS).filter(([k]) => !(v.category === "PROCUREMENT" && k === "PERCENTAGE")).map(([k, l]) => ({ value: k, label: l }))} description={v.basis === "PER_UNIT" ? `Per ${s.quantityUnit}` : undefined} />
        {pctBasis ? (
          <Select label="Percentage of" value={v.percentageBase} onChange={set("percentageBase")} options={[{ value: "PRE_INSURANCE_COST", label: "Cost before insurance (included costs)" }, { value: "PROCUREMENT_VALUE", label: "Procurement value" }]} />
        ) : (
          <Select label="Currency" value={v.currency} onChange={set("currency")} options={currencyOptions} />
        )}
        <Input label={pctBasis ? "Percentage (%)" : `Amount (${v.currency})`} inputMode="decimal" value={v.amount} disabled={v.notProvided} onChange={set("amount")} error={errors.amount} />
        <div className="flex items-end pb-2">
          <Checkbox label="Not provided yet (unknown)" checked={v.notProvided} onChange={(e) => setV({ ...v, notProvided: e.target.checked })} />
        </div>
        {v.category === "PROCUREMENT" && <Input label="Wastage (%)" inputMode="decimal" value={v.wastagePercent} onChange={set("wastagePercent")} error={errors.wastagePercent} description="Applied as base × (1 + wastage %)." />}
        <Select label="Source" value={v.sourceType} onChange={set("sourceType")} options={Object.entries(SOURCE_LABELS).filter(([k]) => k !== "SYSTEM_DERIVED" && (k !== "FREIGHT_QUOTE" || v.category === "FREIGHT")).map(([k, l]) => ({ value: k, label: l }))} />
        <Select label="Confidence" value={v.confidence} onChange={set("confidence")} options={Object.entries(CONFIDENCE_LABELS).map(([k, l]) => ({ value: k, label: l.label }))} />
        {v.category === "FREIGHT" && (
          <>
            <Select label="Freight rate type" value={v.freightQuoteType} onChange={set("freightQuoteType")} options={Object.entries(FREIGHT_QUOTE_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
            <Input label="Carrier / forwarder" value={v.carrier} onChange={set("carrier")} />
            <Input label="Transit days" inputMode="numeric" value={v.transitDays} onChange={set("transitDays")} error={errors.transitDays} />
          </>
        )}
        <Input label="Quote reference" value={v.quoteReference} onChange={set("quoteReference")} />
        <Input label="Quote date" type="date" value={v.quoteDate} onChange={set("quoteDate")} />
        <Input label="Valid until" type="date" value={v.validUntil} onChange={set("validUntil")} error={errors.validUntil} description="Expired quotes are flagged." />
        {(v.category === "INLAND_TRANSPORT" || v.category === "FREIGHT") && <Input label="Route" placeholder="e.g. Ahmedabad → Mundra" value={v.routeNotes} onChange={set("routeNotes")} containerClassName="sm:col-span-2" />}
        {conditional && (
          <Select
            label={`Include in ${s.incoterm}?`}
            value={v.includeOverride}
            onChange={set("includeOverride")}
            options={[
              { value: "", label: `Policy default (${policy.conditional.find((x) => x.category === v.category)!.defaultIncluded ? "included" : "excluded"})` },
              { value: "true", label: "Include" },
              { value: "false", label: "Exclude" },
            ]}
          />
        )}
        {!conditional && v.category !== "PROCUREMENT" && <HelperText className="sm:col-span-2">{policy.included.includes(v.category) ? `Always included in ${s.incoterm}.` : `Not part of ${s.incoterm} — kept for other scenarios/terms.`}</HelperText>}
        <Input label="Notes" value={v.notes} onChange={set("notes")} containerClassName="sm:col-span-2" />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={m.isPending}>{m.isPending ? "Saving…" : line ? "Save cost" : "Add cost"}</Button>
        </div>
      </form>
    </Modal>
  );
}
