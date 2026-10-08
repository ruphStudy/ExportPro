"use client";

import { useQuery } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { QUALITY_STATUSES, type GoodsReceiptDetail } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { day, ProcurementTabs, QualityBadge, useCan, useProcMutation, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ReceiptsPage() {
  return (
    <RequirePermission permission="procurement.view">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Receipts />
      </Suspense>
    </RequirePermission>
  );
}

function Receipts() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const g = (k: string) => params.get(k) ?? "";
  const f = { quality: g("quality"), search: g("search"), page: Number(g("page") || 1) };
  const grn = g("grn");
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page" && k !== "grn") p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  const list = useQuery({ queryKey: ["procurement", "receipts", f], queryFn: () => procurementApi.receipts({ ...f, pageSize: 20 }) });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Procurement</PageTitle>
        <HelperText className="mt-1">Goods receipts and quality inspection. Goods on hold or failed block procurement completion.</HelperText>
      </div>
      <ProcurementTabs />
      {grn && <ReceiptPanel id={grn} onClose={() => set("grn", "")} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input aria-label="Search receipts" placeholder="GRN or SPO number" defaultValue={f.search} onKeyDown={(e) => e.key === "Enter" && set("search", (e.target as HTMLInputElement).value.trim())} />
        <Select aria-label="Quality" value={f.quality} onChange={(e) => set("quality", e.target.value)} options={[{ value: "", label: "Any quality status" }, ...QUALITY_STATUSES.map((s) => ({ value: s, label: words(s) }))]} />
      </div>
      {list.isLoading ? <Skeleton className="h-48 w-full" /> : list.isError || !list.data ? (
        <ErrorState title="Could not load goods receipts" message={toFriendlyErrorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState icon={PackageOpen} title="No goods receipts" description="Receipts are recorded from an issued supplier PO." />
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label="Goods receipts">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => set("grn", r.id)}>{r.grnNumber}</button> <span className="break-words">{r.supplier.legalName} · <Link className="text-primary hover:underline" href={`/procurement/orders/${r.supplierPo.id}`}>{r.supplierPo.spoNumber}</Link></span>
                    <Caption className="block">{r.quantity} {r.unit} · {day(r.receivedAt)}{r.location ? ` · ${r.location}` : ""}</Caption>
                  </div>
                  <QualityBadge status={r.qualityStatus} />
                </Card>
              </li>
            ))}
          </ul>
          <Pagination meta={list.data.meta} onPageChange={(p) => set("page", String(p))} />
        </>
      )}
    </div>
  );
}

function ReceiptPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["procurement", "receipt", id], queryFn: () => procurementApi.receipt(id) });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Could not load goods receipt" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <Receipt g={q.data} onClose={onClose} />;
}

function Receipt({ g, onClose }: { g: GoodsReceiptDetail; onClose: () => void }) {
  const can = useCan();
  const [itemId, setItemId] = useState(g.items[0]?.id ?? "");
  const latest = g.inspections.filter((i) => i.itemId === itemId).at(-1);
  const [v, setV] = useState({ status: "PASSED", acceptedQuantity: "", rejectedQuantity: "", reason: "", notes: "", checks: g.qualityRequirements ? g.qualityRequirements.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((r) => ({ requirement: r, result: "PASS" })) : [] });
  const [file, setFile] = useState<File | null>(null);
  const needsReason = ["FAILED", "HOLD", "PARTIAL", "WAIVED"].includes(v.status);
  const save = useProcMutation(
    async () => {
      const body = { itemId, status: v.status, acceptedQuantity: v.acceptedQuantity || undefined, rejectedQuantity: v.rejectedQuantity || undefined, reason: v.reason || undefined, notes: v.notes || undefined, checks: v.checks.map((c) => ({ ...c, note: null })), ...(latest ? { expectedRowVersion: latest.rowVersion } : {}) };
      const res = latest ? await procurementApi.reinspect(g.id, latest.id, body) : await procurementApi.inspect(g.id, body);
      const insp = res.inspections.filter((i) => i.itemId === itemId).at(-1);
      if (file && insp) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", "INSPECTION_IMAGE");
        return procurementApi.uploadInspectionFile(insp.id, fd, () => undefined);
      }
      return res;
    },
    "Inspection recorded",
    () => setFile(null),
  );
  return (
    <Card className="p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SectionTitle className="text-base">{g.grnNumber} · {g.supplier.legalName}</SectionTitle>
          <Caption>Received {day(g.receivedAt)} by {g.receivedBy ?? "user"}{g.location ? ` at ${g.location}` : ""}{g.overReceiptReason ? ` · over-receipt: ${g.overReceiptReason}` : ""}</Caption>
        </div>
        <div className="flex items-center gap-2"><QualityBadge status={g.qualityStatus} /><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
      <table className="mt-2 w-full text-left">
        <thead><tr className="text-muted-foreground"><th className="py-1">Line</th><th>Received</th><th>Damaged</th><th>Accepted</th><th>Rejected</th></tr></thead>
        <tbody>{g.items.map((i) => <tr key={i.id} className="border-t border-border"><td className="py-1">{i.productName}</td><td>{i.received} {i.unit}</td><td>{i.damaged}</td><td>{i.accepted}</td><td>{i.rejected}</td></tr>)}</tbody>
      </table>
      <ul className="mt-3 flex flex-col gap-2">
        {g.inspections.map((i) => (
          <li key={i.id} className="rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2"><QualityBadge status={i.status} /><span>accepted {i.acceptedQuantity}, rejected {i.rejectedQuantity}</span><Caption>{i.inspector ?? "user"} · {day(i.inspectedAt)}</Caption></div>
            {i.reason && <p className="mt-1">Reason: {i.reason}</p>}
            {i.checks.length > 0 && <ul className="mt-1 list-disc pl-5">{i.checks.map((c) => <li key={c.requirement}>{c.requirement}: {c.result}</li>)}</ul>}
            {i.attachments.map((a) => <a key={a.id} className="mr-2 text-primary hover:underline" href={procurementApi.attachmentHref(a.id)}>{a.filename}</a>)}
          </li>
        ))}
      </ul>
      {can("quality.manage") && g.availableActions.includes("inspect") && (
        <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          {g.items.length > 1 && <Select label="Line" value={itemId} onChange={(e) => setItemId(e.target.value)} options={g.items.map((i) => ({ value: i.id, label: i.productName }))} />}
          <Select label={latest ? "Update inspection" : "Inspection result"} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={QUALITY_STATUSES.filter((s) => s !== "PENDING").map((s) => ({ value: s, label: words(s) }))} />
          {v.status !== "HOLD" && <Input label="Accepted qty" inputMode="decimal" placeholder={v.status === "PASSED" ? "All usable" : ""} value={v.acceptedQuantity} onChange={(e) => setV({ ...v, acceptedQuantity: e.target.value })} />}
          {v.status !== "HOLD" && <Input label="Rejected qty" inputMode="decimal" value={v.rejectedQuantity} onChange={(e) => setV({ ...v, rejectedQuantity: e.target.value })} />}
          {v.checks.length > 0 && (
            <fieldset className="sm:col-span-2 lg:col-span-4">
              <legend className="text-sm font-medium">Checklist from PO quality requirements</legend>
              <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {v.checks.map((c, k) => <li key={c.requirement} className="flex items-center gap-2"><span className="flex-1 break-words">{c.requirement}</span><Select aria-label={`Result for ${c.requirement}`} containerClassName="w-28" value={c.result} onChange={(e) => setV({ ...v, checks: v.checks.map((x, j) => (j === k ? { ...x, result: e.target.value } : x)) })} options={["PASS", "FAIL", "NA"].map((x) => ({ value: x, label: x }))} /></li>)}
              </ul>
            </fieldset>
          )}
          <Textarea label={needsReason ? "Reason (required)" : "Reason"} required={needsReason} rows={2} containerClassName="sm:col-span-2" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          <Input label="Photo / lab report" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="flex items-end"><Button type="submit" disabled={save.isPending || (needsReason && v.reason.trim().length < 3)}>Save inspection</Button></div>
        </form>
      )}
    </Card>
  );
}
