"use client";

import { useQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { useState } from "react";
import type { AutomationConditions, AutomationRuleView } from "@exportpro/types";
import { ACTION_TRIGGERS } from "@exportpro/types";
import { automationApi } from "@/lib/api/ai-ops";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { ActionTabs, useCan, useOpsMutation, words } from "@/components/ai-ops/shared";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const cond = (c: AutomationConditions) => {
  const p: string[] = [];
  if (c.minSeverity) p.push(`severity ≥ ${c.minSeverity.toLowerCase()}`);
  if (c.minDaysOverdue !== undefined) p.push(`≥ ${c.minDaysOverdue} day(s) overdue`);
  if (c.minAmount !== undefined) p.push(`amount ≥ ${c.minAmount}`);
  if (c.noReplyDays !== undefined) p.push(`no reply ≥ ${c.noReplyDays} days`);
  if (c.daysBeforeExpiry !== undefined) p.push(`expires within ${c.daysBeforeExpiry} days`);
  if (c.minEtaDelayDays !== undefined) p.push(`ETA delay ≥ ${c.minEtaDelayDays} days`);
  if (c.minScore !== undefined) p.push(`score ≥ ${c.minScore}`);
  if (c.windowStates?.length) p.push(c.windowStates.map(words).join("/"));
  return p.join(", ") || "always";
};

const FIELDS: Record<string, { key: keyof AutomationConditions; label: string }[]> = {
  NO_BUYER_RESPONSE: [{ key: "noReplyDays", label: "No reply for (days)" }],
  PAYMENT_OVERDUE: [{ key: "minDaysOverdue", label: "Min days overdue" }, { key: "minAmount", label: "Min amount (reporting currency)" }],
  DOCUMENT_EXPIRY: [{ key: "daysBeforeExpiry", label: "Days before expiry" }],
  ETA_CHANGE: [{ key: "minEtaDelayDays", label: "Min ETA delay (days)" }],
  QUOTATION_EXPIRY: [{ key: "daysBeforeExpiry", label: "Days before validity ends" }],
  NEW_OPPORTUNITY: [{ key: "minScore", label: "Min opportunity score" }],
};

export default function AutomationPage() {
  return (
    <RequirePermission permission="automation.view">
      <Automation />
    </RequirePermission>
  );
}

function Automation() {
  const can = useCan();
  const manage = can("automation.manage");
  const q = useQuery({ queryKey: ["ops", "rules"], queryFn: automationApi.rules });
  const [status, setStatus] = useState("");
  const runs = useQuery({ queryKey: ["ops", "runs", status], queryFn: () => automationApi.runs({ status, pageSize: 30 }) });
  const approve = useOpsMutation((id: string) => automationApi.approve(id), "Approved and executed");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Action Center</PageTitle>
        <HelperText className="mt-1">Automation rules turn system signals into Action Center items, unsent drafts or tasks. Rules use a fixed list of triggers, conditions and safe actions — no scripts. Each rule acts once per source condition, and cross-module writes wait for human approval. Nothing is sent, approved or paid automatically.</HelperText>
      </div>
      <ActionTabs />
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !q.data ? (
        <ErrorState title="Could not load automation rules" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          {!q.data.rules.length ? <EmptyState icon={Workflow} title="No automation rules yet" description="Add a template below." /> : (
            <ul className="flex flex-col gap-2">{q.data.rules.map((r) => <li key={r.id}><RuleCard r={r} manage={manage} /></li>)}</ul>
          )}
          {manage && <NewRule templates={q.data.templates} allowed={q.data.allowedActions} />}
        </>
      )}
      <Card className="p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="text-base">Automation history</SectionTitle>
          <Select aria-label="Run status" containerClassName="w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "", label: "All results" }, ...["EXECUTED", "PENDING_APPROVAL", "SKIPPED", "FAILED"].map((x) => ({ value: x, label: words(x) }))]} />
        </div>
        {runs.isLoading ? <Skeleton className="mt-2 h-24 w-full" /> : !runs.data?.items.length ? <HelperText className="mt-2">No runs yet.</HelperText> : (
          <ul className="mt-2 flex flex-col gap-2">
            {runs.data.items.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5"><Badge variant={r.status === "EXECUTED" ? "success" : r.status === "FAILED" ? "danger" : r.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>{words(r.status)}</Badge><span className="break-words">{r.ruleName}</span></span>
                  <Caption className="block break-words">{words(r.triggerType)} · {r.condition} · {r.result ?? r.skippedReason ?? r.error ?? ""} · {new Date(r.createdAt).toLocaleString()}</Caption>
                </div>
                {manage && r.status === "PENDING_APPROVAL" && <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>Approve</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RuleCard({ r, manage }: { r: AutomationRuleView; manage: boolean }) {
  const toggle = useOpsMutation(() => (r.enabled ? automationApi.disable(r.id) : automationApi.enable(r.id)), r.enabled ? "Rule disabled" : "Rule enabled");
  return (
    <Card className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5"><Badge variant={r.enabled ? "success" : "neutral"}>{r.enabled ? "Enabled" : "Disabled"}</Badge>{r.requiresApproval && <Badge variant="warning">Requires approval</Badge>}<span className="break-words font-medium">{r.name}</span></span>
        <Caption className="block break-words">When {words(r.triggerType).toLowerCase()} ({cond(r.conditions)}) → {words(r.actionType).toLowerCase()}{r.actionConfig.priority ? ` · priority ${r.actionConfig.priority.toLowerCase()}` : ""}</Caption>
        <Caption className="block">{r.lastRunAt ? `Last run ${new Date(r.lastRunAt).toLocaleString()} · ${r.lastResult ?? ""}` : "Not run yet"}</Caption>
      </div>
      {manage && <Button size="sm" variant="outline" aria-pressed={r.enabled} disabled={toggle.isPending} onClick={() => toggle.mutate(undefined)}>{r.enabled ? "Disable" : "Enable"}</Button>}
    </Card>
  );
}

function NewRule({ templates, allowed }: { templates: { key: string; name: string; description: string }[]; allowed: Record<string, string[]> }) {
  const [mode, setMode] = useState<"template" | "custom">("template");
  const [template, setTemplate] = useState(templates[0]?.key ?? "");
  const [trigger, setTrigger] = useState<string>("PAYMENT_OVERDUE");
  const [action, setAction] = useState("CREATE_ACTION_ITEM");
  const [name, setName] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState("");
  const actions = allowed[trigger] ?? [];
  const create = useOpsMutation(() => {
    if (mode === "template") return automationApi.create({ template });
    const conditions = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
    return automationApi.create({ name: name || undefined, triggerType: trigger, actionType: actions.includes(action) ? action : actions[0], conditions, actionConfig: priority ? { priority } : undefined });
  }, "Rule created", () => setVals({}));
  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <SectionTitle className="text-base">Add a rule</SectionTitle>
      <div role="radiogroup" aria-label="Rule type" className="flex gap-2">
        <Button size="sm" role="radio" aria-checked={mode === "template"} variant={mode === "template" ? "secondary" : "ghost"} onClick={() => setMode("template")}>From template</Button>
        <Button size="sm" role="radio" aria-checked={mode === "custom"} variant={mode === "custom" ? "secondary" : "ghost"} onClick={() => setMode("custom")}>Custom</Button>
      </div>
      {mode === "template" ? (
        <>
          <Select label="Template" value={template} onChange={(e) => setTemplate(e.target.value)} options={templates.map((t) => ({ value: t.key, label: t.name }))} />
          <Caption>{templates.find((t) => t.key === template)?.description}</Caption>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select label="Trigger" value={trigger} onChange={(e) => { setTrigger(e.target.value); setVals({}); }} options={ACTION_TRIGGERS.map((t) => ({ value: t, label: words(t) }))} />
          <Select label="Action" value={actions.includes(action) ? action : actions[0]} onChange={(e) => setAction(e.target.value)} options={actions.map((a) => ({ value: a, label: words(a) }))} description={action === "CREATE_CRM_TASK" ? "Always waits for approval." : undefined} />
          <Select label="Priority override" value={priority} onChange={(e) => setPriority(e.target.value)} options={[{ value: "", label: "Deterministic (default)" }, ...["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((x) => ({ value: x, label: words(x) }))]} />
          {(FIELDS[trigger] ?? []).map((f) => <Input key={f.key} label={f.label} inputMode="numeric" value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />)}
        </div>
      )}
      <Button className="self-start" disabled={create.isPending} onClick={() => create.mutate(undefined)}>Create rule</Button>
    </Card>
  );
}
