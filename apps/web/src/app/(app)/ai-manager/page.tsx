"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Send } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { AiConfirmResult, AiResponse } from "@exportpro/types";
import { aiManagerApi } from "@/lib/api/ai-ops";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { RequirePermission } from "@/components/layout/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

type Entry = { id: string; role: "user"; text: string } | { id: string; role: "assistant"; r: AiResponse; result?: AiConfirmResult | null; error?: string } | { id: string; role: "error"; text: string };

export default function AiManagerPage() {
  return (
    <RequirePermission permission="ai_manager.use">
      <AiManager />
    </RequirePermission>
  );
}

function AiManager() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["ai", "catalog"], queryFn: aiManagerApi.catalog });
  const actions = useQuery({ queryKey: ["ai", "actions"], queryFn: aiManagerApi.actions });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conv, setConv] = useState<string | null>(null);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const scroll = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  const send = useMutation({
    mutationFn: (b: { message?: string; command?: string }) => aiManagerApi.message({ ...b, conversationId: conv }),
    onMutate: (b) => {
      setEntries((e) => [...e, { id: `u${Date.now()}`, role: "user", text: b.command ?? b.message ?? "" }]);
      scroll();
    },
    onSuccess: (r) => {
      setConv(r.conversationId);
      setEntries((e) => [...e, { id: r.messageId, role: "assistant", r }]);
      if (r.preview) qc.invalidateQueries({ queryKey: ["ai", "actions"] });
      scroll();
    },
    onError: (err) => setEntries((e) => [...e, { id: `e${Date.now()}`, role: "error", text: toFriendlyErrorMessage(err) }]),
  });
  const submit = (msg?: string, command?: string) => {
    const m = (command ?? msg ?? "").trim();
    if (!m || send.isPending) return;
    send.mutate(command ? { command } : { message: m });
    setText("");
  };
  const provider = catalog.data?.provider;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>AI Export Manager</PageTitle>
        <HelperText className="mt-1">Ask about your products, buyers, RFQs, documents, shipments and payments. Answers come from your ExportPro data with sources; anything that changes data is shown for your confirmation first. The AI never invents prices, buyers, payments, shipment events or compliance facts.</HelperText>
      </div>
      {provider && provider.name !== "anthropic" && (
        <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          {provider.available ? "Rule-based command interpreter (development mode) — not AI." : "AI interpretation is unavailable. Quick commands and module shortcuts still work; the Action Center and Analytics are unaffected."}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_18rem]">
        <Card className="flex min-w-0 flex-col p-0">
          <div className="flex max-h-[60vh] min-h-[16rem] flex-col gap-3 overflow-y-auto p-4" aria-live="polite" aria-label="Conversation">
            {!entries.length && (
              <div className="flex flex-col items-start gap-3 text-sm">
                <Bot className="size-6 text-primary" aria-hidden="true" />
                <p>Try a quick command:</p>
                <div className="flex flex-wrap gap-2">
                  {catalog.isLoading ? <Skeleton className="h-8 w-64" /> : (catalog.data?.quickCommands ?? []).map((c) => <Button key={c.label} size="sm" variant="outline" onClick={() => submit(undefined, c.command)}>{c.label}</Button>)}
                </div>
              </div>
            )}
            {entries.map((e) => (e.role === "user" ? <UserBubble key={e.id} text={e.text} /> : e.role === "error" ? <p key={e.id} role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm text-danger">{e.text}</p> : <AssistantMessage key={e.id} r={e.r} onCommand={(c) => submit(undefined, c)} />))}
            {send.isPending && <p className="text-sm text-muted-foreground" role="status">Thinking…</p>}
            <div ref={endRef} />
          </div>
          <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
            <label htmlFor="ai-input" className="sr-only">Message to AI Export Manager</label>
            <textarea id="ai-input" rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(text); } }} placeholder="e.g. Analyze cumin for UAE" className="min-w-0 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            <Button type="submit" disabled={!text.trim() || send.isPending} aria-label="Send"><Send className="size-4" aria-hidden="true" /></Button>
          </form>
        </Card>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="AI actions">
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">Recent actions</SectionTitle>
            {actions.isLoading ? <Skeleton className="mt-2 h-16 w-full" /> : !actions.data?.length ? <HelperText className="mt-1">No AI actions yet.</HelperText> : (
              <ul className="mt-2 flex flex-col gap-2">
                {actions.data.slice(0, 10).map((x) => (
                  <li key={x.id} className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5"><Badge variant={x.status === "EXECUTED" ? "success" : x.status === "FAILED" ? "danger" : x.status === "CANCELLED" ? "neutral" : "warning"}>{x.status.toLowerCase()}</Badge><span className="break-words">{x.label}</span></span>
                    <Caption className="block break-words">{x.target}{x.result?.href ? <> · <Link className="text-primary hover:underline" href={x.result.href}>open</Link></> : null}{x.error ? ` · ${x.error}` : ""}</Caption>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">What I can do</SectionTitle>
            <ul className="mt-2 flex flex-col gap-1">
              {(catalog.data?.actions ?? []).filter((a) => a.name !== "navigate").map((a) => (
                <li key={a.name} className="flex flex-wrap items-center gap-1.5">
                  <span className={a.allowed ? "" : "text-muted-foreground line-through"}>{a.label}</span>
                  {a.kind === "WRITE" && <Badge variant={a.confirmationRequired ? "warning" : "info"}>{a.confirmationRequired ? "needs confirmation" : "draft only"}</Badge>}
                  {!a.allowed && <Caption>(needs {a.permission})</Caption>}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return <p className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary/10 px-3 py-2 text-sm">{text}</p>;
}

function AssistantMessage({ r, onCommand }: { r: AiResponse; onCommand: (c: string) => void }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<AiConfirmResult | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useMutation({ mutationFn: () => aiManagerApi.confirm(r.preview!.executionId), onSuccess: (x) => { setResult(x); qc.invalidateQueries({ queryKey: ["ai", "actions"] }); }, onError: (e) => setErr(toFriendlyErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => aiManagerApi.cancel(r.preview!.executionId), onSuccess: () => { setCancelled(true); qc.invalidateQueries({ queryKey: ["ai", "actions"] }); }, onError: (e) => setErr(toFriendlyErrorMessage(e)) });
  return (
    <div className="flex max-w-full flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5"><Bot className="size-4 text-primary" aria-hidden="true" /><Caption>{r.interpretedBy === "ai" ? "AI-interpreted" : r.interpretedBy === "command" ? "Quick command" : "Rule-based match"}{r.intent?.action ? ` · ${r.intent.action.replace(/_/g, " ")}` : ""}</Caption></div>
      <p className="whitespace-pre-wrap break-words">{r.text}</p>
      {r.denied && <p role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-2">Not permitted: {r.denied.reason} (requires {r.denied.permission})</p>}
      {r.bullets.length > 0 && <ul className="list-disc pl-5">{r.bullets.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul>}
      {r.table && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead><tr className="text-muted-foreground">{r.table.columns.map((c) => <th key={c} className="py-1 pr-2 font-medium">{c}</th>)}</tr></thead>
            <tbody>{r.table.rows.map((row, i) => <tr key={i} className="border-t border-border">{row.map((c, j) => <td key={j} className="py-1 pr-2 align-top">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {r.clarification && r.clarification.options.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose an option">{r.clarification.options.map((o) => <Button key={o.command} size="sm" variant="outline" onClick={() => onCommand(o.command)}>{o.label}</Button>)}</div>
      )}
      {r.preview && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3" role="group" aria-label="Action preview">
          <p className="font-medium">{r.preview.label}: {r.preview.target}</p>
          <dl className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">{r.preview.values.map((v) => <div key={v.label} className="min-w-0"><dt className="text-xs text-muted-foreground">{v.label}</dt><dd className="break-words">{v.value}</dd></div>)}</dl>
          <Caption className="mt-1 block">{r.preview.effect}</Caption>
          {result ? (
            <div className="mt-2" role="status">
              <Badge variant={result.execution.status === "EXECUTED" ? "success" : "danger"}>{result.execution.status === "EXECUTED" ? "Done" : "Failed"}</Badge>{" "}
              <span>{result.execution.result?.message ?? result.execution.error}</span>
              {result.execution.result?.href && <Button asChild size="sm" variant="ghost"><Link href={result.execution.result.href}>Open</Link></Button>}
              {result.next.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{result.next.map((n) => <Button key={n.command} size="sm" variant="outline" onClick={() => onCommand(n.command)}>{n.label}</Button>)}</div>}
            </div>
          ) : cancelled ? <p className="mt-2 text-muted-foreground">Cancelled — nothing was changed.</p> : r.preview.status === "EXECUTED" ? <p className="mt-2">Already done.</p> : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={confirm.isPending || cancel.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? "Running…" : "Confirm"}</Button>
              <Button size="sm" variant="ghost" disabled={confirm.isPending || cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>
            </div>
          )}
          {err && <p role="alert" className="mt-1 text-danger">{err}</p>}
        </div>
      )}
      {r.provenance.length > 0 && <Caption className="block">Source: {r.provenance.map((p) => `${p.module} — ${p.source}${p.freshness ? ` · ${p.freshness.toLowerCase()}` : ""}${p.asOf ? ` · as of ${p.asOf.slice(0, 10)}` : ""}${p.confidence !== null ? ` · confidence ${p.confidence}%` : ""}`).join(" | ")}</Caption>}
      {(r.links.length > 0 || r.suggestions.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {r.links.map((l) => <Button key={l.href} asChild size="sm" variant="ghost"><Link href={l.href}>{l.label}</Link></Button>)}
          {r.suggestions.map((s) => <Button key={s.command} size="sm" variant="outline" onClick={() => onCommand(s.command)}>{s.label}</Button>)}
        </div>
      )}
    </div>
  );
}
