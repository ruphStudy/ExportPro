"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, CheckCircle2, Copy, GitBranch, Lock, Pencil, Plus, RotateCcw, Scale, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { CostCategory, CostingLineItem, CostingScenario, ExportCostingDetail, IncotermPolicyView, LineCalculation } from "@exportpro/types";
import { COST_CATEGORY_LABELS, COST_CATEGORY_ORDER, COUNTRIES, countryLabel, INCOTERM_ORDER, LOGISTICS_COST_CATEGORIES } from "@exportpro/types";
import { costingApi, currencyOptions, fmtMoney, fmtPct } from "@/lib/api/costing";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { BASIS_LABELS, CONFIDENCE_LABELS, FEASIBILITY_LABELS, FREIGHT_QUOTE_LABELS, PRICING_MODE_LABELS, SOURCE_LABELS, STATUS_LABELS, TRANSPORT_LABELS } from "@/lib/costing-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { FxPanel } from "@/components/costing/fx-panel";
import { LineModal } from "@/components/costing/line-modal";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const DISCLAIMER = "Cost allocation is an operational pricing aid. Contractual responsibilities depend on the named place and agreed Incoterms® terms.";

export default function CostingEditorPage() {
  return (
    <RequirePermission permission="costing.view">
      <Suspense fallback={<PageSkeleton />}>
        <CostingEditor />
      </Suspense>
    </RequirePermission>
  );
}

/** Every mutation returns the full, backend-calculated costing; the client never computes money. */
function useCostingMutation<TArgs>(id: string, fn: (args: TArgs) => Promise<ExportCostingDetail>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(["costings", "detail", id], d);
      qc.invalidateQueries({ queryKey: ["costings", "analysis", id] });
      qc.invalidateQueries({ queryKey: ["costings", "list"] });
      if (success) toast.success(success);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409) {
        toast.error("Not saved", toFriendlyErrorMessage(e));
        qc.invalidateQueries({ queryKey: ["costings", "detail", id] });
      } else toast.error("Could not save", toFriendlyErrorMessage(e));
    },
  });
}

function CostingEditor() {
  const { costingId } = useParams<{ costingId: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const q = useQuery({ queryKey: ["costings", "detail", costingId], queryFn: () => costingApi.get(costingId), retry: (n, e) => !(e instanceof ApiRequestError && e.status < 500) && n < 2 });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Costing not available" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const c = q.data;
  const selected = c.scenarios.find((s) => s.id === sp.get("scenario")) ?? c.scenarios.find((s) => s.isBase) ?? c.scenarios[0];
  const select = (id: string) => router.replace(`${pathname}?scenario=${id}`, { scroll: false });
  const editable = c.status === "DRAFT" || c.status === "READY";
  const can = {
    edit: editable && hasPermission(session, "costing.edit"),
    editLogistics: editable && (hasPermission(session, "costing.edit") || hasPermission(session, "costing.edit_logistics")),
    ready: hasPermission(session, "costing.ready"),
    lock: hasPermission(session, "costing.lock"),
    create: hasPermission(session, "costing.create"),
    archive: hasPermission(session, "costing.edit"),
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Export Costing", href: "/costing" }, { label: c.reference }]} />
      <Header c={c} can={can} />
      {c.status === "LOCKED" && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Locked on {new Date(c.lockedAt!).toLocaleString()}. Inputs, FX and results are frozen in an immutable snapshot. Create a revision to change anything.
        </p>
      )}
      {c.status === "READY" && <p role="status" className="rounded-md border border-info/40 bg-info/5 p-3 text-sm">Marked ready. Editing it returns it to draft (the ready snapshot is kept).</p>}
      {c.status === "DRAFT" && !c.readiness.ready && (
        <section aria-labelledby="readiness-h" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <h2 id="readiness-h" className="font-medium">Incomplete costing — not ready yet</h2>
          <ul className="mt-1 list-disc pl-5">{c.readiness.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}
      <SettingsCard c={c} canEdit={can.edit} />
      <ScenarioBar c={c} selected={selected} onSelect={select} canEdit={can.edit} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <ScenarioForm key={`${selected.id}-${selected.updatedAt}`} c={c} s={selected} canEdit={can.edit} canEditLogistics={can.editLogistics} />
          <FxPanel c={c} s={selected} canEdit={can.edit} />
          <LinesCard c={c} s={selected} canEdit={can.edit} canEditLogistics={can.editLogistics} />
          <AnalysisCard c={c} s={selected} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <ResultCard c={c} s={selected} />
          <IncotermCard policy={c.policies.find((p) => p.incoterm === selected.incoterm)!} s={selected} />
          <HistoryCard c={c} />
        </div>
      </div>
    </div>
  );
}

function Header({ c, can }: { c: ExportCostingDetail; can: { ready: boolean; lock: boolean; create: boolean; archive: boolean } }) {
  const router = useRouter();
  const ready = useCostingMutation(c.id, () => costingApi.ready(c.id, c.rowVersion), "Costing marked ready — snapshot saved");
  const lock = useCostingMutation(c.id, () => costingApi.lock(c.id, c.rowVersion), "Costing locked");
  const archive = useCostingMutation(c.id, () => costingApi.archive(c.id), "Costing archived");
  const restore = useCostingMutation(c.id, () => costingApi.restore(c.id), "Costing restored");
  const revise = useMutation({
    mutationFn: () => costingApi.revise(c.id),
    onSuccess: (d) => {
      toast.success(`Revision ${d.reference} created`);
      router.push(`/costing/${d.id}`);
    },
    onError: (e) => toast.error("Could not create revision", toFriendlyErrorMessage(e)),
  });
  const [confirmLock, setConfirmLock] = React.useState(false);
  const st = STATUS_LABELS[c.status];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Caption className="font-medium uppercase tracking-wide">{c.reference} · version {c.version}</Caption>
          <PageTitle className="break-words">{c.name}</PageTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={st.variant}>{st.label}</Badge>
            {c.productName && <Link className="text-primary hover:underline" href={`/products/${c.productId}`}>{c.productName}{c.context.productHsCode ? ` (HS ${c.context.productHsCode})` : ""}</Link>}
            {c.destinationCountryCode && <span>→ {countryLabel(c.destinationCountryCode)}</span>}
            {c.buyerName && <Link className="text-primary hover:underline" href={`/buyers/${c.buyerCompanyId}`}>{c.buyerName}</Link>}
            {c.context.buyerRiskLevel && <Badge variant="neutral">Buyer risk: {c.context.buyerRiskLevel.toLowerCase().replace("_", " ")}</Badge>}
            {c.crmLeadId && <Link className="text-primary hover:underline" href={`/crm/leads/${c.crmLeadId}`}>CRM lead{c.context.leadStage ? ` · ${c.context.leadStage.toLowerCase()}` : ""}</Link>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.scenarios.length >= 2 && (
            <Button asChild variant="outline"><Link href={`/costing/${c.id}/compare`}><Scale className="size-4" aria-hidden="true" />Compare scenarios</Link></Button>
          )}
          {c.status === "DRAFT" && can.ready && (
            <Button onClick={() => ready.mutate(undefined)} disabled={!c.readiness.ready || ready.isPending} aria-describedby={!c.readiness.ready ? "readiness-h" : undefined}>
              <CheckCircle2 className="size-4" aria-hidden="true" />Mark ready
            </Button>
          )}
          {c.status === "READY" && can.lock && <Button onClick={() => setConfirmLock(true)}><Lock className="size-4" aria-hidden="true" />Lock</Button>}
          {(c.status === "LOCKED" || c.status === "READY") && can.create && (
            <Button variant="outline" onClick={() => revise.mutate()} disabled={revise.isPending}><GitBranch className="size-4" aria-hidden="true" />Create revision</Button>
          )}
          {c.status !== "ARCHIVED" && can.archive && <Button variant="ghost" onClick={() => archive.mutate(undefined)}><Archive className="size-4" aria-hidden="true" />Archive</Button>}
          {c.status === "ARCHIVED" && can.archive && <Button variant="outline" onClick={() => restore.mutate(undefined)}><RotateCcw className="size-4" aria-hidden="true" />Restore</Button>}
        </div>
      </div>
      <ConfirmDialog
        open={confirmLock}
        onOpenChange={setConfirmLock}
        title="Lock this costing?"
        description="Locking freezes inputs, FX rates and results in an immutable snapshot. Further changes require a new revision."
        confirmLabel="Lock costing"
        onConfirm={() => {
          lock.mutate(undefined);
          setConfirmLock(false);
        }}
      />
    </header>
  );
}

function SettingsCard({ c, canEdit }: { c: ExportCostingDetail; canEdit: boolean }) {
  const [v, setV] = React.useState({ name: c.name, calculationCurrency: c.calculationCurrency, quoteCurrency: c.quoteCurrency, thinMarginPercent: c.thinMarginPercent, destinationCountryCode: c.destinationCountryCode ?? "", notes: c.notes ?? "" });
  const save = useCostingMutation(c.id, () => costingApi.update(c.id, { ...v, destinationCountryCode: v.destinationCountryCode || null, expectedRowVersion: c.rowVersion }), "Costing saved");
  const dirty = v.name !== c.name || v.calculationCurrency !== c.calculationCurrency || v.quoteCurrency !== c.quoteCurrency || v.thinMarginPercent !== c.thinMarginPercent || v.destinationCountryCode !== (c.destinationCountryCode ?? "") || v.notes !== (c.notes ?? "");
  return (
    <Card className="p-4">
      <details>
        <summary className="cursor-pointer text-sm font-medium">Costing settings · {c.calculationCurrency} calculation, {c.quoteCurrency} quote · thin-margin threshold {c.thinMarginPercent}%</summary>
        <form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          <fieldset disabled={!canEdit} className="contents">
            <Input label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            <Select label="Calculation currency" options={currencyOptions} value={v.calculationCurrency} onChange={(e) => setV({ ...v, calculationCurrency: e.target.value })} />
            <Select label="Quote currency" options={currencyOptions} value={v.quoteCurrency} onChange={(e) => setV({ ...v, quoteCurrency: e.target.value })} />
            <Input label="Thin-margin threshold (%)" inputMode="decimal" value={v.thinMarginPercent} onChange={(e) => setV({ ...v, thinMarginPercent: e.target.value })} description="Margins below this are flagged “Thin margin”." />
            <Select label="Destination market" placeholder="Not set" options={COUNTRIES.map((x) => ({ value: x.code, label: x.label }))} value={v.destinationCountryCode} onChange={(e) => setV({ ...v, destinationCountryCode: e.target.value })} />
            <Textarea label="Internal notes (private to your organization)" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} containerClassName="sm:col-span-2 lg:col-span-3" maxLength={5000} />
          </fieldset>
          {canEdit && <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" size="sm" disabled={!dirty || save.isPending}>Save settings</Button></div>}
        </form>
      </details>
    </Card>
  );
}

function ScenarioBar({ c, selected, onSelect, canEdit }: { c: ExportCostingDetail; selected: CostingScenario; onSelect: (id: string) => void; canEdit: boolean }) {
  const clone = useCostingMutation(c.id, () => costingApi.createScenario(c.id, { cloneFromScenarioId: selected.id, expectedRowVersion: c.rowVersion }), "Scenario duplicated");
  const del = useCostingMutation(c.id, () => costingApi.deleteScenario(c.id, selected.id, c.rowVersion), "Scenario deleted");
  React.useEffect(() => {
    if (clone.data) onSelect(clone.data.scenarios[clone.data.scenarios.length - 1].id);
  }, [clone.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Scenarios">
      {c.scenarios.map((s) => (
        <Button key={s.id} size="sm" variant={s.id === selected.id ? "secondary" : "outline"} aria-pressed={s.id === selected.id} onClick={() => onSelect(s.id)}>
          {s.name}{s.isBase ? " (Base)" : ""}
          {s.result && !s.result.complete && <span className="sr-only"> — incomplete</span>}
          {s.result && !s.result.complete && <AlertTriangle className="size-3 text-warning" aria-hidden="true" />}
        </Button>
      ))}
      {canEdit && (
        <>
          <Button size="sm" variant="ghost" onClick={() => clone.mutate(undefined)} disabled={clone.isPending || c.scenarios.length >= 10}><Copy className="size-4" aria-hidden="true" />Duplicate “{selected.name}”</Button>
          {!selected.isBase && <Button size="sm" variant="ghost" onClick={() => { del.mutate(undefined); onSelect(c.scenarios.find((s) => s.isBase)!.id); }}><Trash2 className="size-4" aria-hidden="true" />Delete scenario</Button>}
        </>
      )}
    </div>
  );
}

function ScenarioForm({ c, s, canEdit, canEditLogistics }: { c: ExportCostingDetail; s: CostingScenario; canEdit: boolean; canEditLogistics: boolean }) {
  const init = {
    name: s.name,
    quantity: s.quantity,
    quantityUnit: s.quantityUnit,
    netWeightKg: s.netWeightKg ?? "",
    cartonCount: s.cartonCount ?? "",
    containerCount: s.containerCount ?? "",
    incoterm: s.incoterm,
    incotermPlace: s.incotermPlace ?? "",
    originPort: s.originPort ?? "",
    destinationPort: s.destinationPort ?? "",
    transportMode: s.transportMode ?? "",
    supplierLabel: s.supplierLabel ?? "",
    pricingMode: s.pricingMode,
    pricingValue: s.pricingValue ?? "",
    buyerTargetPrice: s.buyerTargetPrice ?? "",
  };
  const [v, setV] = React.useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const nul = (x: string) => (x.trim() === "" ? null : x.trim());
  const body = canEdit
    ? { ...v, netWeightKg: nul(v.netWeightKg), cartonCount: nul(v.cartonCount), containerCount: nul(v.containerCount), incotermPlace: nul(v.incotermPlace), originPort: nul(v.originPort), destinationPort: nul(v.destinationPort), transportMode: nul(v.transportMode), supplierLabel: nul(v.supplierLabel), pricingValue: nul(v.pricingValue), buyerTargetPrice: nul(v.buyerTargetPrice) }
    : { originPort: nul(v.originPort), destinationPort: nul(v.destinationPort), transportMode: nul(v.transportMode) };
  const save = useCostingMutation(c.id, () => costingApi.updateScenario(c.id, s.id, { ...(body as object), expectedRowVersion: c.rowVersion }), "Scenario saved and recalculated");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const pvLabel = v.pricingMode === "TARGET_PRICE" ? `Target price per ${v.quantityUnit} (${c.quoteCurrency})` : v.pricingMode === "MARGIN" ? "Desired margin (%)" : "Markup (%)";
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Scenario: {s.name}</SectionTitle>
      <form className="mt-3 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-1 text-sm font-medium sm:col-span-2 lg:col-span-4">Quantity</legend>
          <Input label="Scenario name" value={v.name} onChange={set("name")} />
          <Input label="Quantity" inputMode="decimal" value={v.quantity} onChange={set("quantity")} required />
          <Select label="Unit" options={["KG", "MT", "UNIT", "CARTON", "CONTAINER"].map((u) => ({ value: u, label: u }))} value={v.quantityUnit} onChange={set("quantityUnit")} />
          <Input label="Supplier label" placeholder="e.g. Supplier A" value={v.supplierLabel} onChange={set("supplierLabel")} />
          <Input label="Net weight (kg)" inputMode="decimal" value={v.netWeightKg} onChange={set("netWeightKg")} description={v.quantityUnit === "KG" || v.quantityUnit === "MT" ? "Derived from quantity." : "Needed for per-kg / per-MT costs."} disabled={v.quantityUnit === "KG" || v.quantityUnit === "MT"} />
          <Input label="Cartons" inputMode="decimal" value={v.cartonCount} onChange={set("cartonCount")} description="For per-carton costs." disabled={v.quantityUnit === "CARTON"} />
          <Input label="Containers" inputMode="decimal" value={v.containerCount} onChange={set("containerCount")} description="Capacity is never assumed." disabled={v.quantityUnit === "CONTAINER"} />
        </fieldset>
        <fieldset disabled={!canEditLogistics} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-1 text-sm font-medium sm:col-span-2 lg:col-span-4">Incoterm® &amp; logistics</legend>
          <Select label="Incoterm®" options={INCOTERM_ORDER.map((t) => ({ value: t, label: `${t} — ${c.policies.find((p) => p.incoterm === t)!.label}` }))} value={v.incoterm} onChange={set("incoterm")} disabled={!canEdit} />
          <Input label="Named place" placeholder="e.g. Mundra" value={v.incotermPlace} onChange={set("incotermPlace")} disabled={!canEdit} />
          <Input label="Origin port" value={v.originPort} onChange={set("originPort")} />
          <Input label="Destination port" value={v.destinationPort} onChange={set("destinationPort")} />
          <Select label="Transport mode" placeholder="Not set" options={Object.entries(TRANSPORT_LABELS).map(([k, l]) => ({ value: k, label: l }))} value={v.transportMode} onChange={set("transportMode")} />
        </fieldset>
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-1 text-sm font-medium sm:col-span-2 lg:col-span-3">Pricing</legend>
          <Select label="Pricing method" options={Object.entries(PRICING_MODE_LABELS).map(([k, l]) => ({ value: k, label: l }))} value={v.pricingMode} onChange={set("pricingMode")} />
          <Input label={pvLabel} inputMode="decimal" value={v.pricingValue} onChange={set("pricingValue")} />
          <Input label={`Buyer target price per ${v.quantityUnit} (${c.quoteCurrency})`} inputMode="decimal" value={v.buyerTargetPrice} onChange={set("buyerTargetPrice")} description="Compared only — never applied automatically." />
        </fieldset>
        {(canEdit || canEditLogistics) && (
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>{save.isPending ? "Recalculating…" : "Save & recalculate"}</Button>
            {dirty && <Caption role="status">Unsaved changes — results reflect the last saved inputs.</Caption>}
          </div>
        )}
      </form>
    </Card>
  );
}

function LinesCard({ c, s, canEdit, canEditLogistics }: { c: ExportCostingDetail; s: CostingScenario; canEdit: boolean; canEditLogistics: boolean }) {
  const [editing, setEditing] = React.useState<CostingLineItem | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<CostingLineItem | null>(null);
  const del = useCostingMutation(c.id, (lineId: string) => costingApi.deleteLine(c.id, lineId, c.rowVersion), "Cost removed");
  const calcs = new Map((s.result?.lines ?? []).map((l) => [l.lineId, l]));
  const canLine = (cat: CostCategory) => canEdit || (canEditLogistics && LOGISTICS_COST_CATEGORIES.includes(cat));
  const groups = COST_CATEGORY_ORDER.map((cat) => ({ cat, lines: s.lines.filter((l) => l.category === cat) })).filter((g) => g.lines.length);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="text-base">Cost inputs</SectionTitle>
        {(canEdit || canEditLogistics) && <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />Add cost</Button>}
      </div>
      <HelperText>Amounts are your inputs. “Not provided” is different from zero. Excluded lines stay visible but don’t count under this Incoterm®.</HelperText>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No costs yet. Start with the procurement / product cost.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Cost lines for scenario {s.name}</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>{["Cost", "Input", "Calculation", `Amount (${c.calculationCurrency})`, "In price?", "Source", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.cat}>
                <tr className="bg-muted/20"><th scope="rowgroup" colSpan={7} className="px-3 py-1.5 text-left text-xs font-semibold">{COST_CATEGORY_LABELS[g.cat]}</th></tr>
                {g.lines.map((l) => <LineRow key={l.id} l={l} calc={calcs.get(l.id)} c={c} canEdit={canLine(l.category)} onEdit={() => setEditing(l)} onDelete={() => setDeleting(l)} />)}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {editing && <LineModal c={c} s={s} line={editing === "new" ? null : editing} canEditAll={canEdit} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this cost?"
        description={deleting ? `“${deleting.label}” will be removed from scenario ${s.name} only.` : undefined}
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </Card>
  );
}

function LineRow({ l, calc, c, canEdit, onEdit, onDelete }: { l: CostingLineItem; calc?: LineCalculation; c: ExportCostingDetail; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const expired = l.validUntil && new Date(l.validUntil) < new Date();
  const conf = CONFIDENCE_LABELS[l.confidence];
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2">
        <span className="font-medium">{l.label}</span>
        {l.routeNotes && <Caption className="block">{l.routeNotes}</Caption>}
        {l.category === "FREIGHT" && l.freightQuoteType && <Caption className="block">{FREIGHT_QUOTE_LABELS[l.freightQuoteType]}{l.carrier ? ` · ${l.carrier}` : ""}{l.transitDays !== null ? ` · ${l.transitDays} days` : ""}</Caption>}
      </td>
      <td className="px-3 py-2">
        {l.amount === null ? <Badge variant="warning">Not provided</Badge> : l.basis === "PERCENTAGE" ? `${l.amount}%` : fmtMoney(l.amount, l.currency, 2)}
        <Caption className="block">{BASIS_LABELS[l.basis]}{l.wastagePercent ? ` · ${l.wastagePercent}% wastage` : ""}</Caption>
      </td>
      <td className="max-w-[16rem] px-3 py-2 text-xs text-muted-foreground">{calc?.formula ?? "—"}</td>
      <td className="px-3 py-2 tabular-nums">{calc?.converted ? fmtMoney(calc.converted, c.calculationCurrency) : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-2">
        {calc ? (calc.included ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" aria-hidden="true" />Included</span> : <span className="inline-flex items-center gap-1 text-muted-foreground"><XCircle className="size-4" aria-hidden="true" />Excluded</span>) : "—"}
        {calc && <Caption className="block">{calc.inclusionReason}</Caption>}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <Badge variant={conf.variant}>{conf.label}</Badge>
          <Caption>{SOURCE_LABELS[l.sourceType]}</Caption>
          {expired && <Badge variant="danger">Quote expired</Badge>}
          {l.validUntil && !expired && <Caption>Valid to {l.validUntil.slice(0, 10)}</Caption>}
        </div>
      </td>
      <td className="px-3 py-2">
        {canEdit && (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${l.label}`}><Pencil className="size-4" aria-hidden="true" /></Button>
            <Button size="icon" variant="ghost" onClick={onDelete} aria-label={`Remove ${l.label}`}><Trash2 className="size-4" aria-hidden="true" /></Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function ResultCard({ c, s }: { c: ExportCostingDetail; s: CostingScenario }) {
  const r = s.result;
  if (!r) return <Card className="p-4"><Skeleton className="h-32 w-full" /></Card>;
  const p = r.pricing;
  const total = r.totalCost ? Number(r.totalCost) : 0;
  const cats = r.categories.filter((x) => x.included && x.amount);
  return (
    <Card className="flex flex-col gap-4 p-4" aria-live="polite">
      <div>
        <SectionTitle className="text-base">{r.incoterm}{s.incotermPlace ? ` ${s.incotermPlace}` : ""} result</SectionTitle>
        <Caption>{r.formulaVersion} · calculated {new Date(r.calculatedAt).toLocaleString()}</Caption>
      </div>
      {!r.complete ? (
        <div role="alert" className="rounded-md border border-warning/50 bg-warning/5 p-3 text-sm">
          <p className="font-medium">Totals withheld — inputs incomplete</p>
          <ul className="mt-1 list-disc pl-5">{r.issues.filter((i) => i.blocking).map((i) => <li key={`${i.code}-${i.lineId ?? i.category ?? i.currency}`}>{i.message}</li>)}</ul>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Metric label="Total cost" value={fmtMoney(r.totalCost, r.calculationCurrency)} />
            <Metric label={`Cost per ${r.quantityUnit}`} value={fmtMoney(r.costPerUnit, r.calculationCurrency)} sub={p?.costPerUnitQuote ? fmtMoney(p.costPerUnitQuote, p.quoteCurrency) : undefined} />
          </dl>
          <div>
            <h3 className="text-sm font-medium">Cost breakdown</h3>
            <ul className="mt-2 flex flex-col gap-1.5" aria-label="Included costs">
              {cats.map((x) => {
                const share = total ? (Number(x.amount) / total) * 100 : 0;
                return (
                  <li key={x.category} className="text-xs">
                    <div className="flex justify-between gap-2"><span>{COST_CATEGORY_LABELS[x.category]}</span><span className="tabular-nums">{fmtMoney(x.amount, r.calculationCurrency)} ({share.toFixed(1)}%)</span></div>
                    <div className="mt-0.5 h-1.5 rounded bg-muted" aria-hidden="true"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.max(1, share)}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </div>
          {p ? (
            <div className="flex flex-col gap-2">
              <dl className="grid grid-cols-2 gap-3">
                <Metric label={`Selling price / ${r.quantityUnit}`} value={fmtMoney(p.sellingPricePerUnit, r.calculationCurrency)} sub={p.sellingPricePerUnitQuote ? fmtMoney(p.sellingPricePerUnitQuote, p.quoteCurrency) : `${p.quoteCurrency}: FX rate required`} />
                <Metric label={`Profit / ${r.quantityUnit}`} value={fmtMoney(p.profitPerUnit, r.calculationCurrency)} />
                <Metric label="Total profit" value={fmtMoney(p.totalProfit, r.calculationCurrency)} sub={`Revenue ${fmtMoney(p.totalRevenue, r.calculationCurrency)}`} />
                <Metric label="Margin / markup" value={`${fmtPct(p.marginPercent)} / ${fmtPct(p.markupPercent)}`} sub="Margin = profit ÷ price · Markup = profit ÷ cost" />
              </dl>
              <p className="text-sm"><Badge variant={FEASIBILITY_LABELS[p.feasibility].variant}>{FEASIBILITY_LABELS[p.feasibility].label}</Badge> <span className="sr-only">feasibility</span><Caption> deterministic thresholds: loss &lt; 0, break-even within ±0.5%, thin below {c.thinMarginPercent}%</Caption></p>
              {p.buyerTarget && (
                <p className="text-sm">
                  Buyer target {fmtMoney(p.buyerTarget.pricePerUnit, p.buyerTarget.currency, 4)} / {r.quantityUnit}:{" "}
                  {p.buyerTarget.gapPercent === null ? "FX rate required to compare" : p.buyerTarget.position === "EQUAL" ? "matches your price" : `your price is ${p.buyerTarget.position === "ABOVE" ? "above" : "below"} by ${p.buyerTarget.gapPercent.replace("-", "")}%`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Enter a pricing method value to calculate the selling price.</p>
          )}
        </>
      )}
      {r.issues.filter((i) => !i.blocking).length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground" aria-label="Warnings">
          {r.issues.filter((i) => !i.blocking).map((i) => <li key={`${i.code}-${i.lineId ?? i.currency ?? ""}`} className="flex gap-1"><AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden="true" />{i.message}</li>)}
        </ul>
      )}
      {r.fxUsed.length > 0 && <Caption>FX used: {r.fxUsed.map((f) => `${f.pair} ${f.rate} (${f.sourceType.toLowerCase()}, ${f.sourceDate})`).join(" · ")}</Caption>}
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-base font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function IncotermCard({ policy, s }: { policy: IncotermPolicyView; s: CostingScenario }) {
  const present = new Set(s.lines.map((l) => l.category));
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Included in {policy.incoterm}{s.incotermPlace ? ` ${s.incotermPlace}` : ""}</SectionTitle>
      <HelperText>{policy.label}. {policy.explanation}</HelperText>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {COST_CATEGORY_ORDER.map((cat) => {
          const inc = cat === "PROCUREMENT" || policy.included.includes(cat);
          const cond = policy.conditional.find((x) => x.category === cat);
          const yes = inc || Boolean(cond?.defaultIncluded);
          return (
            <li key={cat} className="flex items-center gap-2">
              {yes ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <XCircle className="size-4 text-muted-foreground" aria-hidden="true" />}
              <span>{COST_CATEGORY_LABELS[cat]}</span>
              <span className="sr-only">{yes ? "included" : "excluded"}</span>
              {cond && <Caption>(seller-side, {cond.defaultIncluded ? "included" : "excluded"} by default — changeable per line)</Caption>}
              {policy.required.includes(cat) && <Caption>· required</Caption>}
              {!present.has(cat) && yes && <Caption>· no cost entered</Caption>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{DISCLAIMER} Incoterms® is a trademark of the International Chamber of Commerce; ExportPro is not affiliated with ICC.</p>
    </Card>
  );
}

function AnalysisCard({ c, s }: { c: ExportCostingDetail; s: CostingScenario }) {
  const [shifts, setShifts] = React.useState("-5,-2,0,2,5");
  const a = useQuery({ queryKey: ["costings", "analysis", c.id, s.id, s.updatedAt, shifts], queryFn: () => costingApi.analysis(c.id, s.id, shifts) });
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Incoterm® &amp; FX comparison</SectionTitle>
      <HelperText>Same inputs priced under each term, and with exchange rates shifted. Saved scenarios and FX snapshots are not changed.</HelperText>
      {a.isLoading ? (
        <Skeleton className="mt-3 h-32 w-full" />
      ) : a.isError || !a.data ? (
        <p role="alert" className="mt-3 text-sm text-danger">{toFriendlyErrorMessage(a.error)}</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Incoterm comparison</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["Term", "Total cost", "Cost / unit", "Price / unit", "Profit", "Margin"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {a.data.incoterms.map((r) => (
                  <tr key={r.incoterm} className="border-t border-border">
                    <th scope="row" className="px-3 py-1.5 text-left font-medium">{r.incoterm}{r.incoterm === s.incoterm ? <span className="text-xs font-normal text-muted-foreground"> (selected)</span> : null}</th>
                    {r.complete ? (
                      <>
                        <td className="px-3 py-1.5 tabular-nums">{fmtMoney(r.totalCost, c.calculationCurrency)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmtMoney(r.costPerUnit, c.calculationCurrency)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmtMoney(r.sellingPricePerUnit, c.calculationCurrency)}</td>
                        <td className="px-3 py-1.5 tabular-nums">{fmtMoney(r.totalProfit, c.calculationCurrency)}</td>
                        <td className="px-3 py-1.5">{fmtPct(r.marginPercent)}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-3 py-1.5 text-xs text-muted-foreground">Incomplete — required costs or FX missing for {r.incoterm}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Input label="FX shifts (%)" value={shifts} onChange={(e) => setShifts(e.target.value)} containerClassName="w-48" description="Comma-separated, e.g. -5,0,5" />
          </div>
          {s.fx.length === 0 ? (
            <HelperText className="mt-2">No foreign-currency rates are used in this scenario.</HelperText>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">FX sensitivity</caption>
                <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["Shift", "Rates", "Total cost", `Price / unit (${c.quoteCurrency})`, "Profit", "Margin"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {a.data.fxSensitivity.map((r) => (
                    <tr key={r.shiftPercent} className="border-t border-border">
                      <th scope="row" className="px-3 py-1.5 text-left font-medium">{r.shiftPercent === 0 ? "Base" : `${r.shiftPercent > 0 ? "+" : ""}${r.shiftPercent}%`}</th>
                      <td className="px-3 py-1.5 text-xs">{r.rates.map((x) => `${x.pair} ${x.rate}`).join(", ")}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmtMoney(r.totalCost, c.calculationCurrency)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.sellingPricePerUnitQuote ? fmtMoney(r.sellingPricePerUnitQuote, c.quoteCurrency, 4) : "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmtMoney(r.totalProfit, c.calculationCurrency)}</td>
                      <td className="px-3 py-1.5">{fmtPct(r.marginPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Caption className="mt-2 block">+X% = each foreign currency is worth X% more in {c.calculationCurrency}.</Caption>
        </>
      )}
    </Card>
  );
}

function HistoryCard({ c }: { c: ExportCostingDetail }) {
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Versions &amp; snapshots</SectionTitle>
      {c.revisions.length > 1 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Revisions">
          {c.revisions.map((r) => (
            <li key={r.id}>{r.id === c.id ? <span className="font-medium">{r.reference} (this)</span> : <Link className="text-primary hover:underline" href={`/costing/${r.id}`}>{r.reference}</Link>} · v{r.version} · {STATUS_LABELS[r.status].label}</li>
          ))}
        </ul>
      )}
      {c.snapshots.length === 0 ? (
        <HelperText className="mt-2">No snapshots yet. Marking ready or locking stores an immutable snapshot of inputs, FX and results.</HelperText>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Snapshots">
          {c.snapshots.map((sn) => <li key={sn.id}>{sn.kind === "LOCKED" ? "Locked" : "Ready"} snapshot · {new Date(sn.createdAt).toLocaleString()}{sn.createdBy ? ` · ${sn.createdBy}` : ""} · {sn.formulaVersion}</li>)}
        </ul>
      )}
    </Card>
  );
}
