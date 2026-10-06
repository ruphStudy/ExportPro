"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Clock, GripVertical, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { CrmLeadSummary, CrmStage, LeadHealth, LeadPriority, LostReason } from "@exportpro/types";
import {
  countryLabel,
  CRM_STAGE_LABELS,
  LEAD_PRIORITY_LABELS,
  LOST_REASON_LABELS,
  LOST_REASONS,
  OPEN_CRM_STAGES,
} from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { crmApi } from "@/lib/api/crm";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { fmtDay, fmtValue, HEALTH_LABEL, PRIORITY_VARIANT, relativeDays } from "@/lib/crm-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ManualBuyerModal } from "@/components/buyers/manual-buyer-modal";
import { RiskBadge } from "@/components/buyers/buyer-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText } from "@/components/ui/typography";

// ------------------------------------------------------------- badges

export function StageBadge({ stage }: { stage: CrmStage }) {
  const variant = stage === "WON" ? "success" : stage === "LOST" ? "danger" : "info";
  return <Badge variant={variant}>{CRM_STAGE_LABELS[stage]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>Priority: {LEAD_PRIORITY_LABELS[priority]}</Badge>;
}

/** CRM Lead Health — follow-up discipline. Deliberately separate from Buyer Risk. */
export function HealthBadge({ health, reasons }: { health: LeadHealth; reasons?: string[] }) {
  const h = HEALTH_LABEL[health];
  return (
    <Badge variant={h.variant} title={reasons?.join(" · ")}>
      {h.label}
      {reasons?.length ? <span className="sr-only">: {reasons.join(", ")}</span> : null}
    </Badge>
  );
}

export function DueText({ iso, overdue }: { iso: string | null; overdue: boolean }) {
  if (!iso) return <span className="text-muted-foreground">No due date</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-danger")}>
      {overdue ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : <CalendarClock className="size-3.5" aria-hidden="true" />}
      {overdue && <span>Overdue:</span>}
      {fmtDay(iso)}
    </span>
  );
}

// ------------------------------------------------------------ mutations

export function useInvalidateCrm() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["crm"] });
    qc.invalidateQueries({ queryKey: ["buyers"] });
  }, [qc]);
}

export function errorToast(title: string, e: unknown) {
  if (e instanceof ApiRequestError && e.code === "CONFLICT") toast.warning("Lead changed elsewhere", e.message);
  else toast.error(title, toFriendlyErrorMessage(e));
}

// -------------------------------------------------------- stage control

const STAGE_OPTIONS = [
  ...OPEN_CRM_STAGES.map((s) => ({ value: s, label: CRM_STAGE_LABELS[s] })),
  { value: "WON", label: "Won…" },
  { value: "LOST", label: "Lost…" },
];

/**
 * Keyboard/screen-reader accessible stage change (drag-and-drop is only a
 * shortcut). WON/LOST open dialogs; closed leads offer Reopen instead.
 */
export function StageControl({ lead, compact, onMoved }: { lead: CrmLeadSummary; compact?: boolean; onMoved?: () => void }) {
  const { data: session } = useSession();
  const invalidate = useInvalidateCrm();
  const [dialog, setDialog] = React.useState<null | "WON" | "LOST" | "REOPEN">(null);
  const m = useMutation({
    mutationFn: (stage: CrmStage) => crmApi.stage(lead.id, { stage, expectedVersion: lead.version }),
    onSuccess: (l) => {
      toast.success(`Moved to ${CRM_STAGE_LABELS[l.stage]}`);
      invalidate();
      onMoved?.();
    },
    onError: (e) => {
      errorToast("Could not change stage", e);
      invalidate();
    },
  });
  const canChange = hasPermission(session, "crm.stage_change");
  if (!canChange) return <StageBadge stage={lead.stage} />;
  const closed = lead.stage === "WON" || lead.stage === "LOST";
  return (
    <>
      {closed ? (
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={lead.stage} />
          <Button size="sm" variant="outline" onClick={() => setDialog("REOPEN")}>Reopen</Button>
        </div>
      ) : (
        <Select
          aria-label={`Stage for ${lead.buyer.name}`}
          label={compact ? undefined : "Stage"}
          value={lead.stage}
          disabled={m.isPending}
          className={compact ? "h-8 text-xs" : undefined}
          options={STAGE_OPTIONS}
          onChange={(e) => {
            const v = e.target.value as CrmStage;
            if (v === "WON" || v === "LOST") setDialog(v);
            else if (v !== lead.stage) m.mutate(v);
          }}
        />
      )}
      {/* Mounted only while open so each dialog starts from the lead's current values. */}
      {dialog === "WON" && <WonDialog lead={lead} open onOpenChange={(o) => setDialog(o ? "WON" : null)} />}
      {dialog === "LOST" && <LostDialog lead={lead} open onOpenChange={(o) => setDialog(o ? "LOST" : null)} />}
      {dialog === "REOPEN" && <ReopenDialog lead={lead} open onOpenChange={(o) => setDialog(o ? "REOPEN" : null)} />}
    </>
  );
}

export function WonDialog({ lead, open, onOpenChange }: { lead: CrmLeadSummary; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateCrm();
  const [reason, setReason] = React.useState("");
  const [value, setValue] = React.useState(lead.expectedValue?.toString() ?? "");
  const [currency, setCurrency] = React.useState(lead.currency ?? "USD");
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const valueError = value && !(Number(value) >= 0) ? "Enter a positive amount." : undefined;
  const m = useMutation({
    mutationFn: () =>
      crmApi.won(lead.id, {
        reason: reason || undefined,
        value: value ? Number(value) : undefined,
        currency: value ? currency : undefined,
        wonAt: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
        expectedVersion: lead.version,
      }),
    onSuccess: (r) => {
      toast.success("Lead marked as won", r.openTasks || r.pendingReminders ? `${r.openTasks} open task(s) and ${r.pendingReminders} reminder(s) are still active — close them if no longer needed.` : undefined);
      onOpenChange(false);
      invalidate();
    },
    onError: (e) => errorToast("Could not mark as won", e),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${lead.buyer.name} as won`}
      description="Closes the lead in the pipeline. No order or shipment is created — those modules come later."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={Boolean(valueError)}>Mark as won</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea label="Won reason (optional)" value={reason} maxLength={300} rows={2} onChange={(e) => setReason(e.target.value)} />
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Input label="Final / expected value (optional)" type="number" min={0} step="0.01" inputMode="decimal" value={value} error={valueError} onChange={(e) => setValue(e.target.value)} />
          <Input label="Currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
        <Input label="Won date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        {lead.signals.openTaskCount > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-sm text-warning" role="note">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            This lead still has {lead.signals.openTaskCount} open task(s). They will stay open until you complete or cancel them.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function LostDialog({ lead, open, onOpenChange }: { lead: CrmLeadSummary; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateCrm();
  const [reason, setReason] = React.useState<LostReason | "">("");
  const [details, setDetails] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const m = useMutation({
    mutationFn: () => crmApi.lost(lead.id, { reason: reason as LostReason, details: details || undefined, expectedVersion: lead.version }),
    onSuccess: () => {
      toast.success("Lead marked as lost", "It stays available under the Lost filter and can be reopened.");
      onOpenChange(false);
      invalidate();
    },
    onError: (e) => errorToast("Could not mark as lost", e),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${lead.buyer.name} as lost`}
      description="History is kept; the lead can be reopened later."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            loading={m.isPending}
            onClick={() => {
              setTouched(true);
              if (reason) m.mutate();
            }}
          >
            Mark as lost
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Lost reason"
          required
          placeholder="Select a reason"
          value={reason}
          error={touched && !reason ? "Select a lost reason." : undefined}
          options={LOST_REASONS.map((r) => ({ value: r, label: LOST_REASON_LABELS[r] }))}
          onChange={(e) => setReason(e.target.value as LostReason)}
        />
        <Textarea label="Details (optional)" value={details} maxLength={1000} rows={3} onChange={(e) => setDetails(e.target.value)} />
      </div>
    </Modal>
  );
}

export function ReopenDialog({ lead, open, onOpenChange }: { lead: CrmLeadSummary; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateCrm();
  const [stage, setStage] = React.useState<CrmStage>("CONTACTED");
  const [reason, setReason] = React.useState("");
  const m = useMutation({
    mutationFn: () => crmApi.reopen(lead.id, { stage, reason: reason || undefined }),
    onSuccess: () => {
      toast.success("Lead reopened", `Now in ${CRM_STAGE_LABELS[stage]}. Previous ${lead.stage === "WON" ? "won" : "lost"} history is kept.`);
      onOpenChange(false);
      invalidate();
    },
    onError: (e) => errorToast("Could not reopen", e),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Reopen lead"
      description={`This ${lead.stage === "WON" ? "won" : "lost"} lead returns to the active pipeline. Stage history is preserved.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>Reopen</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select label="Reopen into stage" value={stage} options={OPEN_CRM_STAGES.map((s) => ({ value: s, label: CRM_STAGE_LABELS[s] }))} onChange={(e) => setStage(e.target.value as CrmStage)} />
        <Textarea label="Reason (optional)" value={reason} maxLength={300} rows={2} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- card

export function LeadCard({
  lead,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  lead: CrmLeadSummary;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const s = lead.signals;
  const value = fmtValue(lead.expectedValue, lead.currency);
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={`${lead.buyer.name}, ${CRM_STAGE_LABELS[lead.stage]}`}
      className={cn("flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm shadow-sm", draggable && "cursor-grab active:cursor-grabbing")}
    >
      <div className="flex items-start gap-1.5">
        {draggable && <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <Link href={`/crm/leads/${lead.id}`} className="block break-words font-medium text-primary hover:underline focus-visible:underline">
            {lead.buyer.name}
          </Link>
          <Caption className="block truncate">
            {[lead.product?.name ?? "No product", countryLabel(lead.countryCode)].join(" · ")}
          </Caption>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge variant={PRIORITY_VARIANT[lead.priority]}>{LEAD_PRIORITY_LABELS[lead.priority]}</Badge>
        {s.stale && <Badge variant="warning">Stale · {s.inactiveDays}d</Badge>}
        {(s.nextActionOverdue || s.overdueTaskCount > 0) && <Badge variant="danger">Overdue</Badge>}
        {lead.tags.slice(0, 3).map((t) => (
          <Badge key={t.id} variant="neutral">#{t.name}</Badge>
        ))}
      </div>
      {lead.nextAction ? (
        <div className="text-xs">
          <span className="text-muted-foreground">Next: </span>
          {lead.nextAction}
          {lead.nextActionDueAt && (
            <span className="block">
              <DueText iso={lead.nextActionDueAt} overdue={s.nextActionOverdue} />
            </span>
          )}
        </div>
      ) : s.suggestedFollowUp ? (
        <p className="text-xs text-muted-foreground">Suggested: {s.suggestedFollowUp}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><UserRound className="size-3" aria-hidden="true" />{lead.owner?.name ?? "Unassigned"}</span>
        <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden="true" />{relativeDays(lead.lastActivityAt)}</span>
        {value && <span className="font-medium text-foreground">{value}</span>}
      </div>
      <StageControl lead={lead} compact />
    </article>
  );
}

export function BuyerRiskInline({ lead }: { lead: CrmLeadSummary }) {
  return <RiskBadge risk={lead.buyer.risk} />;
}

// ------------------------------------------------------------ add lead

/**
 * Direct lead creation reuses existing buyer records: pick a saved buyer,
 * or add a company through the Sprint 10 manual buyer flow, then Add to CRM.
 */
export function AddLeadModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const invalidate = useInvalidateCrm();
  const [buyerId, setBuyerId] = React.useState("");
  const [manualOpen, setManualOpen] = React.useState(false);
  const saved = useQuery({ queryKey: ["buyers", "saved", "crm-picker"], queryFn: () => buyersApi.saved({ page: 1, pageSize: 50 }), enabled: open });
  const items = saved.data?.items ?? [];
  const picked = items.find((i) => i.buyer.id === buyerId);
  const m = useMutation({
    mutationFn: () =>
      crmApi.create({
        buyerCompanyId: buyerId,
        productId: picked?.productId ?? undefined,
        countryCode: picked?.contextCountryCode ?? undefined,
        source: "MANUAL",
      }),
    onSuccess: (r) => {
      toast.success(r.alreadyExists ? "Already in CRM" : "Lead created", r.alreadyExists ? "No duplicate lead was created." : undefined);
      invalidate();
      onOpenChange(false);
      router.push(`/crm/leads/${r.leadId}`);
    },
    onError: (e) => errorToast("Could not create lead", e),
  });
  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Add lead"
        description="Leads are always linked to a buyer company — no second company list is created."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => m.mutate()} disabled={!buyerId} loading={m.isPending}>Create lead</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Saved buyer"
            placeholder={saved.isLoading ? "Loading…" : items.length ? "Select a saved buyer" : "No saved buyers yet"}
            value={buyerId}
            disabled={!items.length}
            options={items.map((i) => ({ value: i.buyer.id, label: `${i.buyer.name} · ${countryLabel(i.buyer.countryCode)}${i.lead ? " (in CRM)" : ""}` }))}
            onChange={(e) => setBuyerId(e.target.value)}
          />
          {picked && <HelperText>Product context: {picked.productName ?? "none"}. Country: {countryLabel(picked.contextCountryCode ?? picked.buyer.countryCode)}.</HelperText>}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="outline" size="sm" asChild><Link href="/buyers">Find buyers</Link></Button>
            <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}><Plus className="size-4" aria-hidden="true" />New company</Button>
          </div>
          <Caption>A new company opens its buyer profile, where you can add it to CRM.</Caption>
        </div>
      </Modal>
      <ManualBuyerModal open={manualOpen} onOpenChange={setManualOpen} />
    </>
  );
}
