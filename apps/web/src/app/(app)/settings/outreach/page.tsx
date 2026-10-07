"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import * as React from "react";
import type { DomainStatus, OutreachSettings } from "@exportpro/types";
import { OUTREACH_HARD_LIMITS } from "@exportpro/types";
import { outreachApi } from "@/lib/api/outreach";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { COMMON_TIMEZONES, DeliveryModeBanner, fmtDateTime } from "@/components/outreach/outreach-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const DOMAIN: Record<DomainStatus, { label: string; variant: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  NOT_CONFIGURED: { label: "Not configured", variant: "neutral" },
  PENDING: { label: "Verification pending", variant: "warning" },
  VERIFIED: { label: "Verified by provider", variant: "success" },
  FAILED: { label: "Verification failed", variant: "danger" },
  DEVELOPMENT_ONLY: { label: "Development only", variant: "info" },
};
const CAP_LABELS: [keyof OutreachSettings["provider"]["capabilities"], string][] = [
  ["realDelivery", "Real delivery to buyers"],
  ["delivered", "Delivery reports"],
  ["opened", "Open tracking (imperfect)"],
  ["bounces", "Bounce reports"],
  ["complaints", "Spam complaint reports"],
  ["replies", "Automatic reply detection"],
];

export default function OutreachSettingsPage() {
  return (
    <RequirePermission permission="outreach.view">
      <SettingsView />
    </RequirePermission>
  );
}

function SettingsView() {
  const q = useQuery({ queryKey: ["outreach", "settings"], queryFn: outreachApi.settings });
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState title="Outreach settings unavailable" message={toFriendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <Form key={q.data.updatedAt ?? "new"} s={q.data} />;
}

function Form({ s }: { s: OutreachSettings }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const can = hasPermission(session, "outreach.settings");
  const [v, setV] = React.useState({
    fromName: s.fromName ?? "",
    fromEmail: s.fromEmail ?? "",
    replyTo: s.replyTo ?? "",
    companyName: s.companyName ?? "",
    companyWebsite: s.companyWebsite ?? "",
    signature: s.signature ?? "",
    dailyLimit: s.dailyLimit,
    maxRecipientsPerCampaign: s.maxRecipientsPerCampaign,
    maxFollowUps: s.maxFollowUps,
    contactCooldownDays: s.contactCooldownDays,
    timezone: s.timezone,
    enabled: s.enabled,
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: () =>
      outreachApi.updateSettings({
        ...v,
        fromName: v.fromName || null,
        fromEmail: v.fromEmail || null,
        replyTo: v.replyTo || null,
        companyName: v.companyName || null,
        companyWebsite: v.companyWebsite || null,
        signature: v.signature || null,
      }),
    onSuccess: () => {
      toast.success("Outreach settings saved");
      qc.invalidateQueries({ queryKey: ["outreach"] });
    },
    onError: (e) => toast.error("Could not save settings", toFriendlyErrorMessage(e)),
  });
  const verify = useMutation({
    mutationFn: outreachApi.verifyDomain,
    onSuccess: (r) => {
      toast.info("Sender status checked", r.domainMessage ?? undefined);
      qc.invalidateQueries({ queryKey: ["outreach", "settings"] });
    },
    onError: (e) => toast.error("Check failed", toFriendlyErrorMessage(e)),
  });
  const d = DOMAIN[s.domainStatus];
  const num = (k: "dailyLimit" | "maxRecipientsPerCampaign" | "maxFollowUps" | "contactCooldownDays") => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <PageTitle>Outreach settings</PageTitle>
        <HelperText>Sender identity, delivery provider and sending limits for buyer campaigns. Provider API keys are configured on the server and never shown here.</HelperText>
      </div>
      <DeliveryModeBanner mode={s.provider.deliveryMode} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form className="flex min-w-0 flex-col gap-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Card className="flex flex-col gap-3 p-4">
            <SectionTitle className="text-base">Sender</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Sender name" value={v.fromName} maxLength={80} disabled={!can} onChange={(e) => set("fromName", e.target.value)} />
              <Input label="Sender email" type="email" value={v.fromEmail} disabled={!can} description="Must be on a domain verified with your email provider." onChange={(e) => set("fromEmail", e.target.value)} />
              <Input label="Reply-to" type="email" value={v.replyTo} disabled={!can} onChange={(e) => set("replyTo", e.target.value)} />
              <Select label="Timezone" value={v.timezone} disabled={!can} options={[...new Set([v.timezone, ...COMMON_TIMEZONES])].map((z) => ({ value: z, label: z }))} onChange={(e) => set("timezone", e.target.value)} />
            </div>
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <SectionTitle className="text-base">Company branding</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Company name" value={v.companyName} placeholder={s.defaults.companyName} disabled={!can} description="Defaults to your organization name." onChange={(e) => set("companyName", e.target.value)} />
              <Input label="Website" value={v.companyWebsite} placeholder={s.defaults.companyWebsite ?? "https://"} disabled={!can} description="Must be a public http(s) URL." onChange={(e) => set("companyWebsite", e.target.value)} />
            </div>
            <Textarea label="Signature (plain text)" value={v.signature} rows={4} maxLength={1000} disabled={!can} onChange={(e) => set("signature", e.target.value)} />
            <Caption>Emails are lightweight plain text — logos are not embedded.</Caption>
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <SectionTitle className="text-base">Limits &amp; safety</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Messages per day" type="number" min={1} max={OUTREACH_HARD_LIMITS.dailyLimit} value={v.dailyLimit} disabled={!can} description={`Max ${OUTREACH_HARD_LIMITS.dailyLimit}. Extra messages wait for the next day (UTC).`} onChange={num("dailyLimit")} />
              <Input label="Recipients per campaign" type="number" min={1} max={OUTREACH_HARD_LIMITS.maxRecipientsPerCampaign} value={v.maxRecipientsPerCampaign} disabled={!can} description={`Max ${OUTREACH_HARD_LIMITS.maxRecipientsPerCampaign}.`} onChange={num("maxRecipientsPerCampaign")} />
              <Input label="Follow-ups per campaign" type="number" min={0} max={OUTREACH_HARD_LIMITS.maxFollowUps} value={v.maxFollowUps} disabled={!can} description={`0–${OUTREACH_HARD_LIMITS.maxFollowUps}.`} onChange={num("maxFollowUps")} />
              <Input label="Contact cooldown (days)" type="number" min={1} max={180} value={v.contactCooldownDays} disabled={!can} description="Minimum gap before a contact can be in another campaign." onChange={num("contactCooldownDays")} />
            </div>
            <Checkbox label="Outreach enabled for this organization" checked={v.enabled} disabled={!can} onChange={(e) => set("enabled", e.target.checked)} />
          </Card>
          {can && <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save settings</Button></div>}
        </form>
        <aside className="flex min-w-0 flex-col gap-5" aria-label="Delivery status">
          <Card className="flex flex-col gap-3 p-4">
            <SectionTitle className="text-base">Delivery provider</SectionTitle>
            <p className="text-sm font-medium">{s.provider.label}</p>
            <HelperText>{s.provider.message}</HelperText>
            <ul className="flex flex-col gap-1 text-sm" aria-label="Provider capabilities">
              {CAP_LABELS.map(([k, label]) => (
                <li key={k} className="flex items-center gap-2">
                  {s.provider.capabilities[k] ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <XCircle className="size-4 text-muted-foreground" aria-hidden="true" />}
                  <span>{label}<span className="sr-only">: {s.provider.capabilities[k] ? "supported" : "not supported"}</span></span>
                </li>
              ))}
            </ul>
            {s.provider.deliveryMode === "PRODUCTION" && <Caption>Webhook signing: {s.provider.webhookConfigured ? "configured" : "not configured — delivery/bounce events will not be received"}</Caption>}
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <SectionTitle className="flex items-center gap-2 text-base"><MailCheck className="size-4" aria-hidden="true" />Sender domain</SectionTitle>
            <Badge variant={d.variant} className="w-fit">{d.label}</Badge>
            {s.domainMessage && <HelperText>{s.domainMessage}</HelperText>}
            <Caption>Last checked: {fmtDateTime(s.domainCheckedAt)}</Caption>
            {can && <Button variant="outline" size="sm" onClick={() => verify.mutate()} loading={verify.isPending}>Check with provider</Button>}
            <Caption>“Verified” is only shown when the provider confirms the domain.</Caption>
          </Card>
          <Card className="p-4 text-sm">
            <SectionTitle className="text-base">Today</SectionTitle>
            <p className="mt-1">{s.sentToday} of {s.dailyLimit} messages used</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
