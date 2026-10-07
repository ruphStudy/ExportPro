"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import * as React from "react";
import type { CostingScenario, ExportCostingDetail, FxRateSnapshot } from "@exportpro/types";
import { costingApi } from "@/lib/api/costing";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

const label = (f: FxRateSnapshot) => `1 ${f.baseCurrency} = ${f.rate} ${f.quoteCurrency} · ${f.sourceType === "BANK_RATE" ? "bank rate" : "manual"} · ${f.sourceDate}${f.sourceLabel ? ` · ${f.sourceLabel}` : ""}`;

/** Per-scenario FX selection. Rates are entered manually; snapshots are immutable and never fetched or invented. */
export function FxPanel({ c, s, canEdit }: { c: ExportCostingDetail; s: CostingScenario; canEdit: boolean }) {
  const qc = useQueryClient();
  const needed = [...new Set([...s.lines.filter((l) => l.basis !== "PERCENTAGE").map((l) => l.currency), c.quoteCurrency])].filter((x) => x !== c.calculationCurrency);
  const [adding, setAdding] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: (fx: { currency: string; snapshotId: string }[]) => costingApi.updateScenario(c.id, s.id, { fx, expectedRowVersion: c.rowVersion }),
    onSuccess: (d) => {
      qc.setQueryData(["costings", "detail", c.id], d);
      qc.invalidateQueries({ queryKey: ["costings", "analysis", c.id] });
      toast.success("FX rate applied and scenario recalculated");
    },
    onError: (e) => toast.error("Could not apply FX rate", toFriendlyErrorMessage(e)),
  });
  const setFor = (currency: string, snapshotId: string | null) => {
    const rest = s.fx.filter((f) => f.currency !== currency).map((f) => ({ currency: f.currency, snapshotId: f.snapshot.id }));
    save.mutate(snapshotId ? [...rest, { currency, snapshotId }] : rest);
  };
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Exchange rates</SectionTitle>
      <HelperText>Each foreign currency needs an explicit rate to {c.calculationCurrency}. No live rate is fetched or assumed. “Refresh” adds a new snapshot — earlier snapshots and locked costings keep their original rate.</HelperText>
      {needed.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">All inputs are in {c.calculationCurrency}; no FX needed.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {needed.map((cur) => <FxRow key={cur} c={c} s={s} currency={cur} canEdit={canEdit} onSelect={(id) => setFor(cur, id)} onAdd={() => setAdding(cur)} busy={save.isPending} />)}
        </ul>
      )}
      {adding && (
        <ManualRateModal
          base={adding}
          quote={c.calculationCurrency}
          onClose={() => setAdding(null)}
          onCreated={(snap) => {
            setAdding(null);
            qc.invalidateQueries({ queryKey: ["fx"] });
            setFor(snap.baseCurrency === c.calculationCurrency ? snap.quoteCurrency : snap.baseCurrency, snap.id);
          }}
        />
      )}
    </Card>
  );
}

function FxRow({ c, s, currency, canEdit, onSelect, onAdd, busy }: { c: ExportCostingDetail; s: CostingScenario; currency: string; canEdit: boolean; onSelect: (id: string | null) => void; onAdd: () => void; busy: boolean }) {
  const rates = useQuery({ queryKey: ["fx", currency, c.calculationCurrency], queryFn: () => costingApi.fxRates({ baseCurrency: currency, quoteCurrency: c.calculationCurrency }) });
  const current = s.fx.find((f) => f.currency === currency)?.snapshot;
  const options = [...(rates.data ?? [])];
  if (current && !options.some((o) => o.id === current.id)) options.unshift(current);
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={`${currency} → ${c.calculationCurrency}`}
          placeholder="No rate selected"
          value={current?.id ?? ""}
          disabled={!canEdit || busy}
          onChange={(e) => onSelect(e.target.value || null)}
          options={options.map((o) => ({ value: o.id, label: label(o) }))}
          containerClassName="min-w-0 flex-1"
        />
        {canEdit && <Button type="button" variant="outline" size="sm" onClick={onAdd}><RefreshCw className="size-4" aria-hidden="true" />{current ? "Refresh rate" : "Add rate"}</Button>}
      </div>
      {current ? (
        <Caption className="mt-1 block">Captured {new Date(current.capturedAt).toLocaleString()}{current.createdBy ? ` by ${current.createdBy}` : ""} · source date {current.sourceDate}</Caption>
      ) : (
        <Badge variant="warning" className="mt-2">FX rate required</Badge>
      )}
    </li>
  );
}

function ManualRateModal({ base, quote, onClose, onCreated }: { base: string; quote: string; onClose: () => void; onCreated: (s: FxRateSnapshot) => void }) {
  const [v, setV] = React.useState({ rate: "", sourceDate: new Date().toISOString().slice(0, 10), sourceType: "MANUAL" as "MANUAL" | "BANK_RATE", sourceLabel: "" });
  const [err, setErr] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => costingApi.manualFx({ baseCurrency: base, quoteCurrency: quote, rate: v.rate.trim(), sourceDate: v.sourceDate, sourceType: v.sourceType, sourceLabel: v.sourceLabel || undefined }),
    onSuccess: onCreated,
    onError: (e) => setErr(toFriendlyErrorMessage(e)),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Enter ${base} → ${quote} rate`} description="Saved as a new immutable snapshot for your organization." className="w-[calc(100%-2rem)] max-w-md">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\d{1,10}(\.\d{1,10})?$/.test(v.rate.trim()) || Number(v.rate) <= 0) return setErr("Enter a rate greater than zero.");
          setErr(null);
          m.mutate();
        }}
        noValidate
      >
        <Input label={`1 ${base} = ? ${quote}`} required inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} error={err ?? undefined} />
        <Input label="Rate date" type="date" required value={v.sourceDate} onChange={(e) => setV({ ...v, sourceDate: e.target.value })} />
        <Select label="Source" value={v.sourceType} onChange={(e) => setV({ ...v, sourceType: e.target.value as "MANUAL" | "BANK_RATE" })} options={[{ value: "MANUAL", label: "Manual entry" }, { value: "BANK_RATE", label: "Bank rate (entered manually)" }]} />
        <Input label="Reference (optional)" placeholder="e.g. HDFC card rate 6 Oct" value={v.sourceLabel} onChange={(e) => setV({ ...v, sourceLabel: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={m.isPending}>Save rate</Button>
        </div>
      </form>
    </Modal>
  );
}
