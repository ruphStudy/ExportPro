"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useState } from "react";
import { CERT_VERIFICATION, SUPPLIER_ATTACHMENT_CATEGORIES } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { CertBadge, day, money, PoBadge, ProcurementTabs, ProvenanceBadges, QualityBadge, RfqBadge, useCan, useProcMutation, words } from "@/components/procurement/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function SupplierDetailPage() {
  return (
    <RequirePermission permission="suppliers.view">
      <Detail />
    </RequirePermission>
  );
}

function Detail() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const can = useCan();
  const q = useQuery({ queryKey: ["procurement", "supplier", supplierId], queryFn: () => procurementApi.supplier(supplierId) });
  const [cert, setCert] = useState({ type: "", number: "", expiryDate: "" });
  const [file, setFile] = useState<File | null>(null);
  const [cat, setCat] = useState("CATALOG");
  const [pct, setPct] = useState<number | null>(null);
  const addCert = useProcMutation(() => procurementApi.addCertification(supplierId, { type: cert.type.trim(), number: cert.number || null, expiryDate: cert.expiryDate || null }), "Certification added", () => setCert({ type: "", number: "", expiryDate: "" }));
  const setVer = useProcMutation(({ id, verification }: { id: string; verification: string }) => procurementApi.updateCertification(id, { verification }), "Verification updated");
  const upload = useProcMutation(
    ({ certificationId }: { certificationId?: string }) => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("category", cat);
      if (certificationId) fd.append("certificationId", certificationId);
      return procurementApi.uploadSupplierFile(supplierId, fd, setPct);
    },
    "File uploaded (stored privately; not authenticated)",
    () => {
      setFile(null);
      setPct(null);
    },
  );
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Could not load supplier" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const s = q.data;
  const manage = can("suppliers.manage");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageTitle className="break-words">{s.legalName}</PageTitle>
          <HelperText className="mt-1">{[s.tradeName, s.supplierType && words(s.supplierType), [s.city, s.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</HelperText>
          <div className="mt-2"><ProvenanceBadges p={s.provenance} /></div>
          <Caption className="mt-1 block">Last updated {day(s.provenance.lastUpdatedAt)}{s.provenance.lastCheckedAt ? ` · last checked ${day(s.provenance.lastCheckedAt)}` : ""}</Caption>
        </div>
        {can("supplier_rfq.manage") && <Button asChild><Link href={`/procurement/rfqs?new=1&supplierIds=${s.id}${s.productRows[0] ? `&product=${encodeURIComponent(s.productRows[0].productName)}${s.productRows[0].productId ? `&productId=${s.productRows[0].productId}` : ""}` : ""}`}>Request quote</Link></Button>}
      </div>
      <ProcurementTabs />
      {s.duplicates.length > 0 && <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">Possible duplicates: {s.duplicates.map((d) => <Link key={d.id} href={`/procurement/suppliers/${d.id}`} className="text-primary hover:underline"> {d.legalName} ({d.reason})</Link>)}</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Contact &amp; identity</SectionTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
            {([["Contact", s.contactPerson], ["Email", s.email], ["Phone", s.phone], ["Website", s.website], ["Address", s.address], ["GSTIN", s.gstin ? `${s.gstin} (format checked, not verified)` : null], ["PAN", s.pan]] as const).map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v ?? "—"}</dd></Fragment>)}
          </dl>
          {s.notes && <p className="mt-2 whitespace-pre-wrap">{s.notes}</p>}
        </Card>
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Performance (from real history)</SectionTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Supplier POs</dt><dd>{s.performance.orders}</dd>
            <dt className="text-muted-foreground">On-time delivery</dt><dd>{s.performance.onTimeRatePercent ? `${s.performance.onTimeRatePercent}%` : "No history yet"}</dd>
            <dt className="text-muted-foreground">Avg lead time</dt><dd>{s.performance.averageLeadTimeDays ? `${s.performance.averageLeadTimeDays} days` : "—"}</dd>
            <dt className="text-muted-foreground">Quality pass rate</dt><dd>{s.performance.qualityPassRatePercent ? `${s.performance.qualityPassRatePercent}% of ${s.performance.inspections}` : "No inspections yet"}</dd>
            <dt className="text-muted-foreground">Accepted / rejected</dt><dd>{s.performance.acceptedQuantity} / {s.performance.rejectedQuantity}</dd>
          </dl>
          <Caption className="mt-2 block">{s.performance.basis}</Caption>
        </Card>
      </div>
      <Card className="overflow-x-auto p-4 text-sm">
        <SectionTitle className="text-base">Products</SectionTitle>
        <table className="mt-2 w-full min-w-[640px]">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Product</th><th>MOQ</th><th>Capacity</th><th>Indicative price</th><th>Lead time</th><th>Packaging</th></tr></thead>
          <tbody>
            {s.productRows.map((p) => <tr key={p.id} className="border-t border-border"><td className="py-1">{p.productName}{p.specification ? ` — ${p.specification}` : ""}</td><td>{p.moq ? `${p.moq} ${p.moqUnit ?? ""}` : "—"}</td><td>{p.capacity ? `${p.capacity} ${p.capacityUnit ?? ""}/${(p.capacityPeriod ?? "month").toLowerCase()}` : "—"}</td><td>{p.indicativePrice ? `${money(p.indicativePrice, p.currency)}/${p.priceUnit ?? "unit"}` : "—"}</td><td>{p.leadTimeDays !== null ? `${p.leadTimeDays} d` : "—"}</td><td>{p.packaging ?? "—"}</td></tr>)}
          </tbody>
        </table>
        {!s.productRows.length && <HelperText>No products recorded.</HelperText>}
      </Card>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Certifications</SectionTitle>
        <HelperText>An uploaded certificate is not authenticated. Mark it reviewed only after you have checked the document.</HelperText>
        <ul className="mt-2 flex flex-col gap-2">
          {s.certificationRows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.type}</span>{c.number && <span>#{c.number}</span>}<span className="text-muted-foreground">expires {day(c.expiryDate)}</span>
              {c.expired && <Badge variant="danger">Expired</Badge>}<CertBadge v={c.verification} />
              {c.attachment && <a className="text-primary hover:underline" href={procurementApi.attachmentHref(c.attachment.id)}>{c.attachment.filename}</a>}
              {manage && <Select aria-label={`Verification for ${c.type}`} containerClassName="w-48" value={c.verification} onChange={(e) => setVer.mutate({ id: c.id, verification: e.target.value })} options={CERT_VERIFICATION.filter((v) => v !== "EXTERNAL_VERIFIED").map((v) => ({ value: v, label: words(v) }))} />}
              {manage && file && <Button size="sm" variant="secondary" onClick={() => upload.mutate({ certificationId: c.id })}>Attach selected file</Button>}
            </li>
          ))}
          {!s.certificationRows.length && <li className="text-muted-foreground">None recorded.</li>}
        </ul>
        {manage && (
          <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); addCert.mutate(undefined); }}>
            <Input label="Type" placeholder="FSSAI, ISO 22000…" value={cert.type} onChange={(e) => setCert({ ...cert, type: e.target.value })} />
            <Input label="Number" value={cert.number} onChange={(e) => setCert({ ...cert, number: e.target.value })} />
            <Input label="Expiry" type="date" value={cert.expiryDate} onChange={(e) => setCert({ ...cert, expiryDate: e.target.value })} />
            <div className="flex items-end"><Button type="submit" disabled={cert.type.trim().length < 2 || addCert.isPending}>Add certification</Button></div>
          </form>
        )}
      </Card>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Private documents</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1">
          {s.attachments.map((a) => <li key={a.id}><a className="text-primary hover:underline" href={procurementApi.attachmentHref(a.id)}>{a.filename}</a> <Caption>{words(a.category)} · {day(a.createdAt)}</Caption></li>)}
          {!s.attachments.length && <li className="text-muted-foreground">No documents.</li>}
        </ul>
        {manage && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Input type="file" aria-label="Choose file" containerClassName="w-64" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Select aria-label="Document category" containerClassName="w-48" value={cat} onChange={(e) => setCat(e.target.value)} options={SUPPLIER_ATTACHMENT_CATEGORIES.map((c) => ({ value: c, label: words(c) }))} />
            <Button disabled={!file || upload.isPending} onClick={() => upload.mutate({})}>{pct !== null ? `Uploading ${pct}%` : "Upload"}</Button>
          </div>
        )}
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">RFQs &amp; quotes</SectionTitle>
          <ul className="mt-2 flex flex-col gap-1">
            {s.rfqs.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/procurement/rfqs/${r.id}`}>{r.rfqNumber}</Link><span>{r.productName}</span><RfqBadge status={r.status} /></li>)}
            {s.quotes.map((x) => <li key={x.id} className="text-muted-foreground">Quote {x.rfqNumber}: {x.unitPrice ? `${money(x.unitPrice, x.currency)}/${x.unit}` : "price hidden"} · {words(x.review)}</li>)}
            {!s.rfqs.length && <li className="text-muted-foreground">No RFQs yet.</li>}
          </ul>
        </Card>
        <Card className="p-4 text-sm">
          <SectionTitle className="text-base">Supplier POs &amp; quality</SectionTitle>
          <ul className="mt-2 flex flex-col gap-1">
            {s.purchaseOrders.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2"><Link className="text-primary hover:underline" href={`/procurement/orders/${p.id}`}>{p.spoNumber}</Link><PoBadge status={p.status} />{p.total && <span>{money(p.total, p.currency)}</span>}</li>)}
            {s.qualityHistory.map((h) => <li key={h.inspectionId} className="flex flex-wrap items-center gap-2"><span>{h.grnNumber}</span><QualityBadge status={h.status} /><Caption>accepted {h.accepted}, rejected {h.rejected}</Caption></li>)}
            {!s.purchaseOrders.length && <li className="text-muted-foreground">No supplier POs yet.</li>}
          </ul>
        </Card>
      </div>
      <Card className="p-4 text-sm">
        <SectionTitle className="text-base">Activity</SectionTitle>
        <ul className="mt-2 flex flex-col gap-1">{s.activity.map((a) => <li key={a.id}>{a.title} <Caption>{a.actor ?? "System"} · {day(a.createdAt)}</Caption></li>)}</ul>
      </Card>
    </div>
  );
}
