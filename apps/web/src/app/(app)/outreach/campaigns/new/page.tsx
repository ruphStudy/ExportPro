"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Rocket, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import type { CampaignDetail, ContentSource, GenerationType, OutreachTone } from "@exportpro/types";
import {
  COUNTRIES,
  countryLabel,
  EXCLUSION_REASON_LABELS,
  GENERATION_TYPES,
  OUTREACH_LANGUAGES,
  TEMPLATE_TYPE_LABELS,
  TEMPLATE_VARIABLE_HELP,
  TEMPLATE_VARIABLES,
  TONES,
} from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { crmApi } from "@/lib/api/crm";
import { outreachApi } from "@/lib/api/outreach";
import { productsApi } from "@/lib/api/products";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { matchLabel } from "@/lib/buyer-labels";
import { toast } from "@/lib/toast";
import { RiskBadge, VerificationBadge } from "@/components/buyers/buyer-bits";
import { RequirePermission } from "@/components/layout/require-permission";
import { COMMON_TIMEZONES, DeliveryModeBanner, fmtDateTime, InfoNote, RecipientStatusBadge } from "@/components/outreach/outreach-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const STEPS = ["Product & market", "Buyers", "Message", "Personalization", "Schedule", "Review", "Launch"].map((label) => ({ label }));
const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES);
const unknownVars = (t: string) => [...new Set([...t.matchAll(VAR_RE)].map((m) => m[1]).filter((v) => !KNOWN.has(v)))];

export default function NewCampaignPage() {
  return (
    <RequirePermission permission="outreach.create">
      <Suspense fallback={<PageSkeleton />}>
        <Builder />
      </Suspense>
    </RequirePermission>
  );
}

function useCampaign(id: string | null) {
  return useQuery({ queryKey: ["outreach", "campaign", id], queryFn: () => outreachApi.campaign(id!), enabled: Boolean(id) });
}

function Builder() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = sp.get("campaignId");
  const step = Math.min(7, Math.max(1, Number(sp.get("step") ?? 1)));
  const q = useCampaign(id);
  const go = React.useCallback(
    (n: number, newId?: string) => {
      const p = new URLSearchParams(sp.toString());
      p.set("step", String(n));
      if (newId) p.set("campaignId", newId);
      router.push(`${pathname}?${p}`, { scroll: true });
    },
    [sp, router, pathname],
  );
  if (id && q.isLoading) return <PageSkeleton />;
  if (id && (q.isError || !q.data)) return <ErrorState title="Campaign unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const c = q.data ?? null;
  if (c?.locked)
    return (
      <ErrorState
        title="This campaign has been launched"
        message="Launched campaigns are locked. Open the campaign to monitor or pause it."
        onRetry={() => router.push(`/outreach/campaigns/${c.id}`)}
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Outreach", href: "/outreach" }, { label: c ? c.name : "New campaign" }]} />
      <div>
        <PageTitle>{c ? c.name : "New campaign"}</PageTitle>
        <HelperText>Progress is saved as a draft after each step. Nothing is sent until you confirm on the Launch step.</HelperText>
      </div>
      <Stepper label="Campaign builder steps" steps={STEPS} current={step} onStepClick={c ? (n) => go(n) : undefined} />
      <h2 className="sr-only">Step {step} of {STEPS.length}: {STEPS[step - 1].label}</h2>
      {step === 1 || !c ? <ProductStep c={c} onDone={(nid) => go(2, nid)} /> : null}
      {c && step === 2 && <BuyersStep c={c} onBack={() => go(1)} onDone={() => go(3)} />}
      {c && step === 3 && <MessageStep key={c.id} c={c} onBack={() => go(2)} onDone={() => go(4)} />}
      {c && step === 4 && <PreviewStep c={c} onBack={() => go(3)} onDone={() => go(5)} />}
      {c && step === 5 && <ScheduleStep key={c.id} c={c} onBack={() => go(4)} onDone={() => go(6)} />}
      {c && step === 6 && <ReviewStep c={c} onBack={() => go(5)} onDone={() => go(7)} />}
      {c && step === 7 && <LaunchStep c={c} onBack={() => go(6)} />}
    </div>
  );
}

function Nav({ onBack, next, nextLabel = "Save & continue", pending, disabled }: { onBack?: () => void; next?: () => void; nextLabel?: string; pending?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
      {onBack ? <Button variant="outline" onClick={onBack}>Back</Button> : <span />}
      {next && <Button onClick={next} loading={pending} disabled={disabled}>{nextLabel}</Button>}
    </div>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["outreach"] });
}

// --------------------------------------------------------------- step 1

function ProductStep({ c, onDone }: { c: CampaignDetail | null; onDone: (id: string) => void }) {
  const sp = useSearchParams();
  const invalidate = useInvalidate();
  const products = useQuery({ queryKey: ["products", "list", "outreach"], queryFn: () => productsApi.list({ page: 1, pageSize: 100 }) });
  const [name, setName] = React.useState(c?.name ?? "");
  const [productId, setProductId] = React.useState(c?.product?.id ?? sp.get("productId") ?? "");
  const [country, setCountry] = React.useState(c?.countryCode ?? sp.get("country") ?? "");
  const m = useMutation({
    mutationFn: async () => {
      if (c) return outreachApi.updateCampaign(c.id, { name: name || undefined, productId: productId || null, countryCode: country || null });
      return outreachApi.createCampaign({
        name: name || undefined,
        productId: productId || undefined,
        countryCode: country || undefined,
        buyerIds: sp.get("buyers")?.split(",").filter(Boolean),
        leadId: sp.get("leadId") ?? undefined,
      });
    },
    onSuccess: (r) => {
      invalidate();
      onDone(r.id);
    },
    onError: (e) => toast.error("Could not save campaign", toFriendlyErrorMessage(e)),
  });
  const prefilled = sp.get("buyers") || sp.get("leadId");
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionTitle className="text-base">Product &amp; market</SectionTitle>
      {prefilled && !c && <InfoNote>Buyers from your previous page will be added as recipients.</InfoNote>}
      <Input label="Campaign name" value={name} maxLength={120} placeholder="e.g. Turmeric — UAE importers, Q4" onChange={(e) => setName(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Saved product"
          value={productId}
          disabled={products.isLoading}
          options={[{ value: "", label: products.isLoading ? "Loading…" : "No product" }, ...(products.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.displayName} (HS ${p.hsCode})` }))]}
          onChange={(e) => setProductId(e.target.value)}
          description="Only your organization's saved products are listed."
        />
        <Select label="Target country" value={country} options={[{ value: "", label: "Use each buyer's country" }, ...COUNTRIES.map((x) => ({ value: x.code, label: x.label }))]} onChange={(e) => setCountry(e.target.value)} />
      </div>
      <Nav next={() => m.mutate()} pending={m.isPending} />
    </Card>
  );
}

// --------------------------------------------------------------- step 2

interface Row {
  id: string;
  name: string;
  countryCode: string;
  match: number | null;
  risk: { score: number; level: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" } | null;
  verification: string | null;
  contact: string;
  demo: boolean;
}

function BuyersStep({ c, onBack, onDone }: { c: CampaignDetail; onBack: () => void; onDone: () => void }) {
  const invalidate = useInvalidate();
  const current = useQuery({ queryKey: ["outreach", "recipients", c.id, "all"], queryFn: () => outreachApi.recipients(c.id, { pageSize: 100 }) });
  const settings = useQuery({ queryKey: ["outreach", "settings"], queryFn: outreachApi.settings });
  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const sel = selected ?? new Set((current.data?.items ?? []).map((r) => r.buyer.id));
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  const saved = useQuery({ queryKey: ["buyers", "saved", "outreach"], queryFn: () => buyersApi.saved({ page: 1, pageSize: 50 }) });
  const search = useQuery({
    queryKey: ["buyers", "search", "outreach", c.product?.id, c.countryCode],
    queryFn: () => buyersApi.search({ productId: c.product?.id, country: c.countryCode ?? undefined, pageSize: 25 }),
  });
  const leads = useQuery({ queryKey: ["crm", "leads", "outreach"], queryFn: () => crmApi.list({ status: "OPEN", pageSize: 50 }) });
  const m = useMutation({
    mutationFn: () => outreachApi.setRecipients(c.id, [...sel]),
    onSuccess: () => {
      invalidate();
      toast.success("Recipients saved");
    },
    onError: (e) => toast.error("Could not save recipients", toFriendlyErrorMessage(e)),
  });
  const savedRows: Row[] = (saved.data?.items ?? []).map((i) => ({ id: i.buyer.id, name: i.buyer.name, countryCode: i.buyer.countryCode, match: i.buyer.match.score, risk: i.buyer.risk, verification: i.buyer.verificationStatus, contact: i.buyer.contactAvailability, demo: i.buyer.demo }));
  const searchRows: Row[] = (search.data?.items ?? []).map((b) => ({ id: b.id, name: b.name, countryCode: b.countryCode, match: b.match.score, risk: b.risk, verification: b.verificationStatus, contact: b.contactAvailability, demo: b.demo }));
  const leadRows: Row[] = (leads.data?.items ?? []).map((l) => ({ id: l.buyer.id, name: `${l.buyer.name} · ${l.stage.toLowerCase()}`, countryCode: l.buyer.countryCode, match: null, risk: l.buyer.risk, verification: l.buyer.verificationStatus, contact: "UNKNOWN", demo: l.buyer.demo }));
  const max = settings.data?.maxRecipientsPerCampaign ?? 25;
  const dirty = selected !== null;

  const list = (rows: Row[], loading: boolean, empty: string) =>
    loading ? (
      <Skeleton className="h-40 w-full" />
    ) : rows.length === 0 ? (
      <HelperText className="py-4">{empty}</HelperText>
    ) : (
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Selectable buyers">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <Checkbox
              checked={sel.has(r.id)}
              onChange={() => toggle(r.id)}
              label={<span className="font-medium">{r.name}<span className="font-normal text-muted-foreground"> · {countryLabel(r.countryCode)}</span></span>}
            />
            <div className="flex flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
              {r.match !== null && <Badge variant="neutral" aria-label={`Match ${r.match} of 100`}>Match {r.match} · {matchLabel(r.match)}</Badge>}
              {r.risk && <RiskBadge risk={r.risk} />}
              {r.verification && <VerificationBadge status={r.verification as never} />}
              {r.contact === "NONE" ? <Badge variant="warning">No contact</Badge> : r.contact === "VERIFIED" ? <Badge variant="success">Verified contact</Badge> : r.contact === "HAS_CONTACT" ? <Badge variant="neutral">Has contact</Badge> : null}
              {r.demo && <Badge variant="neutral">Sample</Badge>}
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Select buyers</SectionTitle>
          <Badge variant={sel.size > max ? "warning" : "info"} role="status">{sel.size} selected · limit {max} eligible per campaign</Badge>
        </div>
        <InfoNote>High-risk buyers are not excluded automatically — they are flagged “Buyer requires additional verification”. Buyers without a usable email are excluded with a reason.</InfoNote>
        <Tabs defaultValue="saved">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList aria-label="Buyer sources" className="w-max">
              <TabsTrigger value="saved" className="whitespace-nowrap">Saved buyers</TabsTrigger>
              <TabsTrigger value="search" className="whitespace-nowrap">Product &amp; market matches</TabsTrigger>
              <TabsTrigger value="crm" className="whitespace-nowrap">CRM leads</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="saved">{list(savedRows, saved.isLoading, "No saved buyers yet. Shortlist buyers in Buyer Discovery.")}</TabsContent>
          <TabsContent value="search">{list(searchRows, search.isLoading, "No buyers match this product and market.")}</TabsContent>
          <TabsContent value="crm">{list(leadRows, leads.isLoading, "No open CRM leads.")}</TabsContent>
        </Tabs>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => m.mutate()} loading={m.isPending} disabled={!dirty}>Check eligibility</Button>
        </div>
      </Card>
      <EligibilityTable campaignId={c.id} />
      <Nav
        onBack={onBack}
        pending={m.isPending}
        next={async () => {
          if (dirty) await m.mutateAsync().catch(() => undefined);
          onDone();
        }}
      />
    </div>
  );
}

function EligibilityTable({ campaignId }: { campaignId: string }) {
  const q = useQuery({ queryKey: ["outreach", "recipients", campaignId, "all"], queryFn: () => outreachApi.recipients(campaignId, { pageSize: 100 }) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <HelperText>No recipients yet.</HelperText>;
  return (
    <Card className="p-4">
      <SectionTitle className="text-base">Recipients ({items.filter((r) => r.status !== "EXCLUDED").length} eligible of {items.length})</SectionTitle>
      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-max text-sm">
          <caption className="sr-only">Recipient eligibility</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>{["Buyer", "Contact", "Status", "Notes"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2">{r.buyer.name}{r.buyer.demo && <Caption className="block">Sample buyer</Caption>}</td>
                <td className="px-3 py-2">{r.contact ? <>{r.contact.name ?? "—"}<Caption className="block break-all">{r.contact.address}</Caption></> : <span className="text-muted-foreground">None</span>}</td>
                <td className="px-3 py-2"><RecipientStatusBadge status={r.status} reason={r.excludedReason} /></td>
                <td className="px-3 py-2 text-xs">{r.warnings.map((w) => <span key={w} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden="true" />{w}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------- step 3

function MessageStep({ c, onBack, onDone }: { c: CampaignDetail; onBack: () => void; onDone: () => void }) {
  const invalidate = useInvalidate();
  const templates = useQuery({ queryKey: ["outreach", "templates"], queryFn: () => outreachApi.templates() });
  const [subject, setSubject] = React.useState(c.subject);
  const [body, setBody] = React.useState(c.body);
  const [language, setLanguage] = React.useState(c.language);
  const [source, setSource] = React.useState<ContentSource>(c.contentSource);
  const [templateId, setTemplateId] = React.useState<string | null>(c.templateId);
  const [gen, setGen] = React.useState<{ provider: string | null; at: string | null }>({ provider: c.generationProvider, at: c.generatedAt });
  const [aiType, setAiType] = React.useState<GenerationType>("INTRODUCTION");
  const [tone, setTone] = React.useState<OutreachTone>("PROFESSIONAL");
  const [instructions, setInstructions] = React.useState("");
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState<null | { subject: string; body: string; apply: () => void }>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const dirty = Boolean(subject.trim() || body.trim());
  const unknown = unknownVars(`${subject}\n${body}`);

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    if (source === "AI") setSource("AI_EDITED");
    else if (source === "TEMPLATE") setSource("MANUAL");
  };
  const replace = (next: { subject: string; body: string }, apply: () => void) => {
    // Never overwrite the user's edits without confirmation.
    if (dirty && (subject !== next.subject || body !== next.body)) setPending({ ...next, apply });
    else apply();
  };
  const generate = useMutation({
    mutationFn: () => outreachApi.generate({ type: aiType, tone, language, productId: c.product?.id, countryCode: c.countryCode ?? undefined, instructions: instructions || undefined }),
    onSuccess: (g) =>
      replace(g, () => {
        setSubject(g.subject);
        setBody(g.body);
        setSource("AI");
        setTemplateId(null);
        setGen({ provider: g.provider, at: g.generatedAt });
        setWarnings(g.warnings);
      }),
    onError: (e) => toast.error("Generation unavailable", e instanceof ApiRequestError ? e.message : "You can still use a template or write the message yourself."),
  });
  const save = useMutation({
    mutationFn: () =>
      outreachApi.updateCampaign(c.id, { subject, body, language, templateId, contentSource: source, generationProvider: source.startsWith("AI") ? gen.provider : null, generatedAt: source.startsWith("AI") ? gen.at : null }),
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: (e) => toast.error("Could not save message", toFriendlyErrorMessage(e)),
  });
  const insert = (v: string) => {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return edit(setBody)(body + token);
    const start = el.selectionStart ?? body.length;
    edit(setBody)(body.slice(0, start) + token + body.slice(el.selectionEnd ?? start));
    requestAnimationFrame(() => el.focus());
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <SectionTitle className="text-base">Start from a template</SectionTitle>
          <Select
            aria-label="Template"
            value=""
            placeholder={templates.isLoading ? "Loading…" : "Choose a template"}
            options={(templates.data ?? []).map((t) => ({ value: t.id, label: `${t.system ? "System · " : ""}${TEMPLATE_TYPE_LABELS[t.type]} — ${t.name}` }))}
            onChange={(e) => {
              const t = templates.data?.find((x) => x.id === e.target.value);
              if (t)
                replace(t, () => {
                  setSubject(t.subject);
                  setBody(t.body);
                  setLanguage(t.language);
                  setSource("TEMPLATE");
                  setTemplateId(t.id);
                  setWarnings([]);
                });
            }}
          />
          <Caption><Link className="text-primary hover:underline" href="/outreach/templates">Manage templates</Link></Caption>
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <SectionTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4" aria-hidden="true" />Generate a draft</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Type" value={aiType} options={GENERATION_TYPES.map((t) => ({ value: t, label: TEMPLATE_TYPE_LABELS[t] }))} onChange={(e) => setAiType(e.target.value as GenerationType)} />
            <Select label="Tone" value={tone} options={TONES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))} onChange={(e) => setTone(e.target.value as OutreachTone)} />
            <Select label="Language" value={language} options={OUTREACH_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onChange={(e) => setLanguage(e.target.value)} />
          </div>
          <Input label="Instructions (optional)" value={instructions} maxLength={500} placeholder="e.g. Mention we can share specifications" onChange={(e) => setInstructions(e.target.value)} />
          <Button variant="outline" onClick={() => generate.mutate()} loading={generate.isPending}><Wand2 className="size-4" aria-hidden="true" />Generate</Button>
          <InfoNote>Drafts use only your company, product and market data — no invented prices, certifications or buyer history. Always review before launch.</InfoNote>
        </Card>
      </div>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Message</SectionTitle>
          <Badge variant="neutral">Source: {source === "AI_EDITED" ? "Generated, then edited" : source === "AI" ? "Generated" : source === "TEMPLATE" ? "Template" : "Written manually"}</Badge>
        </div>
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md bg-warning/10 p-2 text-sm" aria-label="Review before sending">
            {warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />{w}</li>)}
          </ul>
        )}
        <Input label="Subject" required value={subject} maxLength={200} onChange={(e) => edit(setSubject)(e.target.value)} />
        <Textarea ref={bodyRef} label="Body (plain text)" required value={body} rows={12} maxLength={5000} onChange={(e) => edit(setBody)(e.target.value)} />
        <div>
          <p className="text-xs font-medium">Insert variable</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {TEMPLATE_VARIABLES.map((v) => (
              <button key={v} type="button" title={TEMPLATE_VARIABLE_HELP[v]} onClick={() => insert(v)} className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>
        {unknown.length > 0 && <p role="alert" className="text-sm text-danger">Unknown variable{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{{${u}}}`).join(", ")} — these cannot be sent.</p>}
        <InfoNote>Your signature and an unsubscribe line are appended automatically.</InfoNote>
      </Card>
      <Nav onBack={onBack} next={() => save.mutate()} pending={save.isPending} disabled={!subject.trim() || !body.trim() || unknown.length > 0} />
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title="Replace your current message?"
        description="Your edits to the subject and body will be overwritten."
        confirmLabel="Replace"
        onConfirm={() => {
          pending?.apply();
          setPending(null);
        }}
      />
    </div>
  );
}

// --------------------------------------------------------------- step 4

function PreviewStep({ c, onBack, onDone }: { c: CampaignDetail; onBack: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ["outreach", "preview", c.id, c.subject, c.body], queryFn: () => outreachApi.preview(c.id, {}) });
  const test = useMutation({
    mutationFn: () => outreachApi.testSend(c.id),
    onSuccess: (r) => (r.simulated ? toast.warning("Test recorded — not delivered", r.message) : toast.success("Test email sent", r.message)),
    onError: (e) => toast.error("Test send failed", toFriendlyErrorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Personalized preview</SectionTitle>
          <Button variant="outline" size="sm" onClick={() => test.mutate()} loading={test.isPending}>Test send to me</Button>
        </div>
        <HelperText>Variables resolved for up to five recipients. Test sends go only to your own email and are not counted in analytics.</HelperText>
        {q.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : q.isError ? (
          <ErrorState message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data!.map((p, i) => (
              <li key={p.recipientId ?? i} className="rounded-md border border-border p-3 text-sm">
                <p className="text-xs text-muted-foreground">To: {p.buyerName}{p.toAddress ? ` <${p.toAddress}>` : " (no eligible contact)"}</p>
                <p className="mt-1 font-medium break-words">{p.subject}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{p.body}</pre>
                {p.unresolved.length > 0 && <p role="alert" className="mt-2 text-sm text-danger">Unresolved: {p.unresolved.map((u) => `{{${u}}}`).join(", ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Nav onBack={onBack} next={onDone} nextLabel="Continue" disabled={q.data?.some((p) => p.unresolved.length > 0)} />
    </div>
  );
}

// --------------------------------------------------------------- step 5

/** Wall-clock time in a chosen IANA timezone → UTC ISO (not the browser's zone). */
function zonedToUtc(local: string, tz: string): string {
  const asUtc = new Date(`${local}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const seen = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc.getTime() - (seen - asUtc.getTime())).toISOString();
}
function utcToZoned(iso: string | null, tz: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

function ScheduleStep({ c, onBack, onDone }: { c: CampaignDetail; onBack: () => void; onDone: () => void }) {
  const invalidate = useInvalidate();
  const settings = useQuery({ queryKey: ["outreach", "settings"], queryFn: outreachApi.settings });
  const templates = useQuery({ queryKey: ["outreach", "templates"], queryFn: () => outreachApi.templates() });
  const [mode, setMode] = React.useState(c.sendMode);
  const [tz, setTz] = React.useState(c.timezone);
  const [when, setWhen] = React.useState(utcToZoned(c.scheduledAt && c.sendMode === "SCHEDULED" ? c.scheduledAt : null, c.timezone));
  const [followUps, setFollowUps] = React.useState(c.steps.filter((s) => s.order > 0).map((s) => ({ delayDays: s.delayDays, subject: s.subject, body: s.body })));
  const max = settings.data?.maxFollowUps ?? 2;
  const followTpl = templates.data?.find((t) => t.type === "FOLLOW_UP");
  const save = useMutation({
    mutationFn: () => outreachApi.updateCampaign(c.id, { sendMode: mode, timezone: tz, scheduledAt: mode === "SCHEDULED" && when ? zonedToUtc(when, tz) : null, followUps }),
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: (e) => toast.error("Could not save schedule", toFriendlyErrorMessage(e)),
  });
  const tzOptions = [...new Set([tz, ...COMMON_TIMEZONES])].map((z) => ({ value: z, label: z }));
  const invalid = followUps.some((f) => !f.subject.trim() || !f.body.trim() || unknownVars(f.subject + f.body).length > 0 || f.delayDays < 1);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle className="text-base">When to send</SectionTitle>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Send timing</legend>
          {(["NOW", "SCHEDULED"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="radio" name="sendMode" value={m} checked={mode === m} onChange={() => setMode(m)} className="size-4" />
              {m === "NOW" ? "Send as soon as I launch" : "Schedule for later"}
            </label>
          ))}
        </fieldset>
        {mode === "SCHEDULED" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={`Date & time (${tz})`} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
            <Select label="Timezone" value={tz} options={tzOptions} onChange={(e) => setTz(e.target.value)} />
          </div>
        )}
        <InfoNote>Times are stored in UTC with the timezone you choose. Daily sending limits may spread messages over several days.</InfoNote>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Follow-ups ({followUps.length}/{max})</SectionTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={followUps.length >= max}
            onClick={() => setFollowUps((f) => [...f, { delayDays: f.length ? f[f.length - 1].delayDays + 4 : 3, subject: followTpl?.subject ?? "", body: followTpl?.body ?? "" }])}
          >
            Add follow-up
          </Button>
        </div>
        <HelperText>Each follow-up is sent the given number of days after the previous message — only if the buyer hasn’t replied, bounced or unsubscribed and the campaign isn’t paused.</HelperText>
        {followUps.map((f, i) => (
          <fieldset key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Follow-up {i + 1}</legend>
            <Input label="Days after previous message" type="number" min={1} max={30} value={f.delayDays} onChange={(e) => setFollowUps((all) => all.map((x, j) => (j === i ? { ...x, delayDays: Number(e.target.value) } : x)))} />
            <Input label="Subject" value={f.subject} maxLength={200} onChange={(e) => setFollowUps((all) => all.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))} />
            <Textarea label="Body" value={f.body} rows={5} maxLength={5000} onChange={(e) => setFollowUps((all) => all.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
            {unknownVars(f.subject + f.body).length > 0 && <p role="alert" className="text-sm text-danger">Unknown variables: {unknownVars(f.subject + f.body).join(", ")}</p>}
            <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => setFollowUps((all) => all.filter((_, j) => j !== i))}>Remove</Button></div>
          </fieldset>
        ))}
      </Card>
      <Nav onBack={onBack} next={() => save.mutate()} pending={save.isPending} disabled={invalid || (mode === "SCHEDULED" && !when)} />
    </div>
  );
}

// --------------------------------------------------------------- step 6

function ReviewStep({ c, onBack, onDone }: { c: CampaignDetail; onBack: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ["outreach", "launch-check", c.id, c.subject, c.body, c.steps.length, c.scheduledAt], queryFn: () => outreachApi.launchCheck(c.id) });
  const preview = useQuery({ queryKey: ["outreach", "preview", c.id, c.subject, c.body], queryFn: () => outreachApi.preview(c.id, {}) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState title="Review unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const k = q.data;
  const p = preview.data?.[0];
  return (
    <div className="flex flex-col gap-4">
      <DeliveryModeBanner mode={k.deliveryMode} />
      {k.errors.length > 0 && (
        <section role="alert" aria-labelledby="errs" className="rounded-lg border border-danger/50 bg-danger/5 p-4 text-sm">
          <h3 id="errs" className="font-semibold text-danger">Fix before launch</h3>
          <ul className="mt-1 list-disc pl-5">{k.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </section>
      )}
      {k.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" aria-label="Warnings">
          {k.warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />{w}</li>)}
        </ul>
      )}
      <Card className="p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Campaign">{c.name}</Fact>
          <Fact label="Sender">{k.sender.fromName ? `${k.sender.fromName} <${k.sender.fromEmail ?? "not set"}>` : "Not set"}{k.sender.replyTo ? ` · reply-to ${k.sender.replyTo}` : ""}</Fact>
          <Fact label="Product">{c.product?.name ?? "None"}</Fact>
          <Fact label="Country">{c.countryCode ? countryLabel(c.countryCode) : "Buyer's country"}</Fact>
          <Fact label="Recipients">{k.recipients} total · {k.eligible} eligible · {k.recipients - k.eligible} excluded</Fact>
          <Fact label="Schedule">{c.sendMode === "NOW" ? "On launch" : `${fmtDateTime(c.scheduledAt, c.timezone)} (${c.timezone})`}</Fact>
          <Fact label="Follow-ups">{c.steps.length - 1 ? c.steps.filter((s) => s.order > 0).map((s) => `+${s.delayDays}d`).join(", ") : "None"}</Fact>
          <Fact label="Estimated messages">{k.estimatedMessages} (if nobody replies) · {k.dailyRemaining} left today</Fact>
          <Fact label="Provider">{k.provider.label}</Fact>
        </dl>
        {k.excluded.length > 0 && (
          <div className="mt-3">
            <h3 className="text-sm font-medium">Excluded recipients</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">{k.excluded.map((e) => <li key={e.reason}>{e.count} × {EXCLUSION_REASON_LABELS[e.reason]}</li>)}</ul>
          </div>
        )}
      </Card>
      {p && (
        <Card className="p-4">
          <SectionTitle className="text-base">Message (as {p.buyerName} will see it)</SectionTitle>
          <p className="mt-2 font-medium break-words">{p.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{p.body}</pre>
        </Card>
      )}
      <Nav onBack={onBack} next={onDone} nextLabel="Continue to launch" disabled={!k.ok} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

// --------------------------------------------------------------- step 7

function LaunchStep({ c, onBack }: { c: CampaignDetail; onBack: () => void }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [ok, setOk] = React.useState(false);
  const check = useQuery({ queryKey: ["outreach", "launch-check", c.id, "final"], queryFn: () => outreachApi.launchCheck(c.id) });
  const m = useMutation({
    mutationFn: () => outreachApi.launch(c.id),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.alreadyLaunched ? "Already launched" : "Campaign launched", r.campaign.deliveryMode === "DEVELOPMENT" ? "Development delivery — nothing is sent to buyers." : undefined);
      router.push(`/outreach/campaigns/${c.id}`);
    },
    onError: (e) => toast.error("Launch blocked", toFriendlyErrorMessage(e)),
  });
  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionTitle className="flex items-center gap-2 text-base"><Rocket className="size-4" aria-hidden="true" />Launch</SectionTitle>
      {check.data && <DeliveryModeBanner mode={check.data.deliveryMode} />}
      {check.data && !check.data.ok && <p role="alert" className="text-sm text-danger">Launch is blocked: {check.data.errors.join(" ")}</p>}
      <p className="text-sm">
        {check.data ? `${check.data.eligible} recipient(s) will receive this campaign${c.steps.length > 1 ? ` with up to ${c.steps.length - 1} follow-up(s)` : ""}.` : "Checking…"}
      </p>
      <Checkbox checked={ok} onChange={(e) => setOk(e.target.checked)} label="I reviewed the message, recipients, sender and schedule. Generated content has been checked for accuracy." />
      <Nav onBack={onBack} next={() => m.mutate()} nextLabel={c.sendMode === "SCHEDULED" ? "Schedule campaign" : "Launch now"} pending={m.isPending} disabled={!ok || !check.data?.ok} />
      <Caption className="flex items-center gap-1"><CheckCircle2 className="size-3.5" aria-hidden="true" />Launching twice never sends duplicate messages.</Caption>
    </Card>
  );
}
