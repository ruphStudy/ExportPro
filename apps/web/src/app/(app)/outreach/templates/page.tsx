"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, FileText, Pencil, Plus } from "lucide-react";
import * as React from "react";
import type { OutreachTemplate, OutreachTemplateType } from "@exportpro/types";
import { OUTREACH_LANGUAGES, TEMPLATE_TYPE_LABELS, TEMPLATE_TYPES, TEMPLATE_VARIABLE_HELP, TEMPLATE_VARIABLES } from "@exportpro/types";
import { outreachApi } from "@/lib/api/outreach";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { fmtDateTime } from "@/components/outreach/outreach-bits";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const VAR_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES);

export default function TemplatesPage() {
  return (
    <RequirePermission permission="outreach.view">
      <Templates />
    </RequirePermission>
  );
}

function Templates() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [archived, setArchived] = React.useState(false);
  const [editing, setEditing] = React.useState<OutreachTemplate | "new" | null>(null);
  const [previewing, setPreviewing] = React.useState<OutreachTemplate | null>(null);
  const q = useQuery({ queryKey: ["outreach", "templates", archived], queryFn: () => outreachApi.templates(archived) });
  const can = hasPermission(session, "outreach.templates");
  const act = useMutation({
    mutationFn: ({ t, a }: { t: OutreachTemplate; a: "duplicate" | "archive" | "restore" }) =>
      a === "duplicate" ? outreachApi.duplicateTemplate(t.id) : outreachApi.updateTemplate(t.id, { active: a === "restore" }),
    onSuccess: (_r, v) => {
      toast.success(v.a === "duplicate" ? "Template duplicated" : v.a === "archive" ? "Template archived" : "Template restored");
      qc.invalidateQueries({ queryKey: ["outreach", "templates"] });
    },
    onError: (e) => toast.error("Action failed", toFriendlyErrorMessage(e)),
  });
  const items = q.data ?? [];
  const system = items.filter((t) => t.system);
  const custom = items.filter((t) => !t.system);
  const card = (t: OutreachTemplate) => (
    <li key={t.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{t.name}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="info">{TEMPLATE_TYPE_LABELS[t.type]}</Badge>
            <Badge variant="neutral">{OUTREACH_LANGUAGES.find((l) => l.code === t.language)?.label ?? t.language}</Badge>
            {t.system ? <Badge variant="neutral">System · read-only</Badge> : <Badge variant="neutral">v{t.version}</Badge>}
            {!t.active && <Badge variant="warning">Archived</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPreviewing(t)}>Preview</Button>
          {can && <Button size="sm" variant="ghost" onClick={() => act.mutate({ t, a: "duplicate" })} aria-label={`Duplicate ${t.name}`}><Copy className="size-4" aria-hidden="true" /></Button>}
          {can && !t.system && <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}><Pencil className="size-4" aria-hidden="true" /></Button>}
          {can && !t.system && (
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ t, a: t.active ? "archive" : "restore" })} aria-label={`${t.active ? "Archive" : "Restore"} ${t.name}`}>
              {t.active ? <Archive className="size-4" aria-hidden="true" /> : <ArchiveRestore className="size-4" aria-hidden="true" />}
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm break-words text-muted-foreground">{t.subject}</p>
      <Caption>{t.system ? "Starter template" : `Updated ${fmtDateTime(t.updatedAt)}${t.createdBy ? ` · ${t.createdBy}` : ""}`}</Caption>
    </li>
  );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Outreach", href: "/outreach" }, { label: "Templates" }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle>Templates</PageTitle>
          <HelperText>Reusable messages with controlled variables. Launched campaigns keep their own snapshot, so editing a template never changes past campaigns.</HelperText>
        </div>
        {can && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New template</Button>}
      </header>
      <Checkbox label="Show archived" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <ErrorState message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          <section aria-labelledby="custom-h">
            <SectionTitle id="custom-h" className="text-base">Your templates</SectionTitle>
            {custom.length === 0 ? (
              <EmptyState icon={FileText} title="No custom templates" description="Use a system template or duplicate one to customize it." />
            ) : (
              <ul className="mt-2 grid gap-3 md:grid-cols-2">{custom.map(card)}</ul>
            )}
          </section>
          <section aria-labelledby="system-h">
            <SectionTitle id="system-h" className="text-base">System starter templates</SectionTitle>
            <ul className="mt-2 grid gap-3 md:grid-cols-2">{system.map(card)}</ul>
          </section>
        </>
      )}
      {editing && <EditTemplate key={editing === "new" ? "new" : editing.id} t={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {previewing && <PreviewTemplate t={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

function EditTemplate({ t, onClose }: { t: OutreachTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(t?.name ?? "");
  const [type, setType] = React.useState<OutreachTemplateType>(t?.type ?? "INTRODUCTION");
  const [language, setLanguage] = React.useState(t?.language ?? "en");
  const [subject, setSubject] = React.useState(t?.subject ?? "");
  const [body, setBody] = React.useState(t?.body ?? "");
  const unknown = [...new Set([...`${subject}\n${body}`.matchAll(VAR_RE)].map((m) => m[1]).filter((v) => !KNOWN.has(v)))];
  const m = useMutation({
    mutationFn: () => (t ? outreachApi.updateTemplate(t.id, { name, type, language, subject, body }) : outreachApi.createTemplate({ name, type, language, subject, body })),
    onSuccess: () => {
      toast.success(t ? "Template saved (new version)" : "Template created");
      qc.invalidateQueries({ queryKey: ["outreach", "templates"] });
      onClose();
    },
    onError: (e) => toast.error("Could not save template", toFriendlyErrorMessage(e)),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t ? "Edit template" : "New template"}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={name.trim().length < 2 || !subject.trim() || !body.trim() || unknown.length > 0}>Save</Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <Input label="Name" required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Type" value={type} options={TEMPLATE_TYPES.map((x) => ({ value: x, label: TEMPLATE_TYPE_LABELS[x] }))} onChange={(e) => setType(e.target.value as OutreachTemplateType)} />
          <Select label="Language" value={language} options={OUTREACH_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onChange={(e) => setLanguage(e.target.value)} />
        </div>
        <Input label="Subject" required value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        <Textarea label="Body (plain text)" required value={body} rows={10} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        <div>
          <p className="text-xs font-medium">Allowed variables</p>
          <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground sm:grid-cols-2">
            {TEMPLATE_VARIABLES.map((v) => <li key={v}><code className="text-foreground">{`{{${v}}}`}</code> — {TEMPLATE_VARIABLE_HELP[v]}</li>)}
          </ul>
        </div>
        {unknown.length > 0 && <p role="alert" className="text-sm text-danger">Unknown variable{unknown.length > 1 ? "s" : ""}: {unknown.map((u) => `{{${u}}}`).join(", ")}</p>}
      </div>
    </Modal>
  );
}

function PreviewTemplate({ t, onClose }: { t: OutreachTemplate; onClose: () => void }) {
  const products = useQuery({ queryKey: ["products", "list", "outreach"], queryFn: () => productsApi.list({ page: 1, pageSize: 100 }) });
  const settings = useQuery({ queryKey: ["outreach", "settings"], queryFn: outreachApi.settings });
  const [productId, setProductId] = React.useState("");
  const [buyer, setBuyer] = React.useState("Sample Importers LLC");
  const [contact, setContact] = React.useState("");
  const [country, setCountry] = React.useState("United Arab Emirates");
  const p = products.data?.items.find((x) => x.id === productId);
  const values: Record<string, string> = {
    buyerCompany: buyer,
    contactName: contact || "Sir/Madam",
    productName: p?.displayName ?? "Your product",
    hsCode: p?.hsCode ?? "HS code",
    country,
    senderName: settings.data?.fromName ?? "Sender name",
    companyName: settings.data?.companyName || settings.data?.defaults.companyName || "Your company",
    website: settings.data?.companyWebsite ?? settings.data?.defaults.companyWebsite ?? "",
    unsubscribeLink: "(unsubscribe link)",
  };
  const fill = (s: string) => s.replace(VAR_RE, (w, v: string) => (KNOWN.has(v) ? values[v] || w : w));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Preview: ${t.name}`} className="max-w-2xl">
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select label="Product" value={productId} options={[{ value: "", label: "Sample product" }, ...(products.data?.items ?? []).map((x) => ({ value: x.id, label: x.displayName }))]} onChange={(e) => setProductId(e.target.value)} />
          <Input label="Buyer company" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          <Input label="Contact name" value={contact} placeholder="Sir/Madam" onChange={(e) => setContact(e.target.value)} />
          <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <Card className="p-3">
          <p className="font-medium break-words">{fill(t.subject)}</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{fill(t.body)}</pre>
        </Card>
      </div>
    </Modal>
  );
}
