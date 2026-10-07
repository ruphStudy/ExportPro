"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { BankDetails, CommercialSettings } from "@exportpro/types";
import { commercialApi } from "@/lib/api/commercial";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { CommercialTabs, useCommercialMutation } from "@/components/commercial/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function CommercialSettingsPage() {
  return (
    <RequirePermission permission="commercial.settings">
      <SettingsView />
    </RequirePermission>
  );
}

function SettingsView() {
  const q = useQuery({ queryKey: ["commercial", "settings"], queryFn: commercialApi.settings });
  return (
    <div className="flex min-w-0 max-w-4xl flex-col gap-5">
      <div>
        <PageTitle>Quotes &amp; Orders</PageTitle>
        <HelperText className="mt-1">Numbering, PO comparison tolerances, default terms and bank details for proforma invoices.</HelperText>
      </div>
      <CommercialTabs />
      {q.isLoading ? <PageSkeleton /> : q.isError || !q.data ? <ErrorState title="Could not load settings" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} /> : <SettingsForm key={JSON.stringify(q.data)} s={q.data} />}
    </div>
  );
}

const BANK_FIELDS: { key: keyof BankDetails; label: string; max: number }[] = [
  { key: "bankName", label: "Bank name", max: 120 },
  { key: "beneficiary", label: "Beneficiary", max: 160 },
  { key: "accountNumber", label: "Account number", max: 40 },
  { key: "swift", label: "SWIFT / BIC", max: 11 },
  { key: "iban", label: "IBAN", max: 40 },
  { key: "bankAddress", label: "Bank address", max: 300 },
  { key: "intermediary", label: "Intermediary bank", max: 300 },
];

function SettingsForm({ s }: { s: CommercialSettings }) {
  const [f, setF] = React.useState({
    quotationPrefix: s.quotationPrefix,
    piPrefix: s.piPrefix,
    yearlyReset: s.yearlyReset,
    unitPricePrecision: String(s.unitPricePrecision),
    defaultValidityDays: String(s.defaultValidityDays),
    quantityTolerancePercent: s.quantityTolerancePercent,
    priceTolerancePercent: s.priceTolerancePercent,
    quotationTerms: s.quotationTerms ?? "",
    piTerms: s.piTerms ?? "",
  });
  const blankBank = Object.fromEntries(BANK_FIELDS.map((b) => [b.key, ""])) as Record<keyof BankDetails, string>;
  // Masked values are never echoed back; bank details are only sent when edited.
  const [bank, setBank] = React.useState(s.bankDetailsMasked ? blankBank : { ...blankBank, ...Object.fromEntries(Object.entries(s.bankDetails ?? {}).map(([k, v]) => [k, v ?? ""])) });
  const [bankDirty, setBankDirty] = React.useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const save = useCommercialMutation(
    () =>
      commercialApi.updateSettings({
        quotationPrefix: f.quotationPrefix.trim().toUpperCase(),
        piPrefix: f.piPrefix.trim().toUpperCase(),
        yearlyReset: f.yearlyReset,
        unitPricePrecision: Number(f.unitPricePrecision),
        defaultValidityDays: Number(f.defaultValidityDays),
        quantityTolerancePercent: f.quantityTolerancePercent.trim() || "0",
        priceTolerancePercent: f.priceTolerancePercent.trim() || "0",
        quotationTerms: f.quotationTerms.trim() || null,
        piTerms: f.piTerms.trim() || null,
        ...(bankDirty ? { bankDetails: Object.values(bank).some((v) => v.trim()) ? Object.fromEntries(Object.entries(bank).map(([k, v]) => [k, k === "swift" || k === "iban" ? v.trim().toUpperCase() || null : v.trim() || null])) : null } : {}),
      }),
    "Commercial settings saved",
  );
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} aria-label="Commercial settings">
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Numbering &amp; pricing</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Quotation prefix" value={f.quotationPrefix} onChange={(e) => set("quotationPrefix", e.target.value)} maxLength={8} description={`e.g. ${f.quotationPrefix || "QT"}-2026-000001`} />
          <Input label="PI prefix" value={f.piPrefix} onChange={(e) => set("piPrefix", e.target.value)} maxLength={8} />
          <Select label="Unit price decimals" value={f.unitPricePrecision} onChange={(e) => set("unitPricePrecision", e.target.value)} options={["2", "3", "4"].map((v) => ({ value: v, label: v }))} />
          <Input label="Default validity (days)" type="number" min={1} max={365} value={f.defaultValidityDays} onChange={(e) => set("defaultValidityDays", e.target.value)} />
        </div>
        <Checkbox label="Restart numbering each calendar year" checked={f.yearlyReset} onChange={(e) => set("yearlyReset", e.target.checked)} />
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">PO comparison tolerances</SectionTitle>
        <HelperText>Differences within these percentages are not flagged. Default 0% (exact match).</HelperText>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Quantity tolerance (%)" inputMode="decimal" value={f.quantityTolerancePercent} onChange={(e) => set("quantityTolerancePercent", e.target.value)} />
          <Input label="Price tolerance (%)" inputMode="decimal" value={f.priceTolerancePercent} onChange={(e) => set("priceTolerancePercent", e.target.value)} />
        </div>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Default terms</SectionTitle>
        <Textarea label="Quotation terms & conditions" rows={5} value={f.quotationTerms} onChange={(e) => set("quotationTerms", e.target.value)} maxLength={20000} />
        <Textarea label="Proforma invoice terms" rows={5} value={f.piTerms} onChange={(e) => set("piTerms", e.target.value)} maxLength={20000} />
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">Bank details (printed on proforma invoices)</SectionTitle>
        <HelperText>{s.bankDetailsMasked ? "Saved details are masked. Enter new values to replace them." : "Visible only to roles that manage commercial settings; masked for others and never written to the audit log."}</HelperText>
        <div className="grid gap-3 sm:grid-cols-2">
          {BANK_FIELDS.map((b) => (
            <Input key={b.key} label={b.label} value={bank[b.key]} maxLength={b.max} autoComplete="off" onChange={(e) => { setBankDirty(true); setBank((p) => ({ ...p, [b.key]: e.target.value })); }} containerClassName={b.key === "bankAddress" || b.key === "intermediary" ? "sm:col-span-2" : undefined} />
          ))}
        </div>
      </Card>
      <div className="sticky bottom-0 z-10 -mx-1 flex justify-end border-t border-border bg-background/95 px-1 py-3">
        <Button type="submit" loading={save.isPending}>Save settings</Button>
      </div>
    </form>
  );
}
