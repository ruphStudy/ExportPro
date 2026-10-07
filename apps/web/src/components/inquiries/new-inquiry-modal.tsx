"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { COUNTRIES } from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { inquiriesApi } from "@/lib/api/inquiries";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HelperText } from "@/components/ui/typography";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx,.xls,.eml";

/** Add a manual inquiry or upload an RFQ document. Content is stored as buyer-provided; nothing is extracted until you ask. */
export function NewInquiryModal({ open, onOpenChange, crmLeadId, mode: initialMode = "manual" }: { open: boolean; onOpenChange: (o: boolean) => void; crmLeadId?: string; mode?: "manual" | "upload" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = React.useState(initialMode);
  const [v, setV] = React.useState({ buyerCompanyId: "", buyerName: "", contactEmail: "", subject: "", body: "", countryCode: "", priority: "" });
  const [file, setFile] = React.useState<File | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const saved = useQuery({ queryKey: ["buyers", "saved", "picker"], queryFn: () => buyersApi.saved({ pageSize: 50 }), enabled: open && !crmLeadId });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const done = (id: string) => {
    toast.success(mode === "upload" ? "RFQ uploaded" : "Inquiry added", "Saved as NEW. Run extraction or enter the RFQ manually.");
    qc.invalidateQueries({ queryKey: ["inquiries"] });
    onOpenChange(false);
    router.push(`/inquiries/${id}`);
  };
  const fail = (e: unknown) => {
    const existing = e instanceof ApiRequestError && e.status === 409 ? (e.details as { existingInquiryId?: string } | undefined)?.existingInquiryId : undefined;
    if (existing) {
      toast.info("Already uploaded", toFriendlyErrorMessage(e));
      onOpenChange(false);
      router.push(`/inquiries/${existing}`);
    } else setErrors({ form: toFriendlyErrorMessage(e) });
    setProgress(null);
  };
  const manual = useMutation({
    mutationFn: () =>
      inquiriesApi.create({
        buyerCompanyId: v.buyerCompanyId || undefined,
        buyerName: v.buyerCompanyId ? undefined : v.buyerName.trim() || undefined,
        contactEmail: v.contactEmail.trim() || undefined,
        subject: v.subject.trim(),
        body: v.body,
        countryCode: v.countryCode || undefined,
        priority: v.priority || undefined,
        crmLeadId,
      }),
    onSuccess: (d) => done(d.id),
    onError: fail,
  });
  const upload = useMutation({
    mutationFn: () => inquiriesApi.upload(file!, { buyerCompanyId: v.buyerCompanyId || undefined, buyerName: v.buyerCompanyId ? undefined : v.buyerName.trim() || undefined, subject: v.subject.trim() || undefined, message: v.body.trim() || undefined, crmLeadId }, setProgress),
    onSuccess: (d) => done(d.id),
    onError: fail,
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (mode === "manual") {
      if (!crmLeadId && !v.buyerCompanyId && v.buyerName.trim().length < 2) er.buyerName = "Select a saved buyer or enter the buyer company name.";
      if (v.subject.trim().length < 2) er.subject = "Enter a subject.";
      if (v.body.trim().length < 5) er.body = "Paste or type the buyer's message.";
      if (v.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contactEmail)) er.contactEmail = "Enter a valid email.";
    } else if (!file) er.file = "Choose an RFQ file.";
    else if (file.size > 10 * 1024 * 1024) er.file = "File must be 10 MB or smaller.";
    setErrors(er);
    if (Object.keys(er).length) return;
    setProgress(mode === "upload" ? 0 : null);
    (mode === "manual" ? manual : upload).mutate();
  };
  const pending = manual.isPending || upload.isPending;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={mode === "manual" ? "Add buyer inquiry" : "Upload RFQ"} className="max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto">
      <div className="mb-3 flex gap-2" role="group" aria-label="Inquiry type">
        <Button type="button" size="sm" variant={mode === "manual" ? "secondary" : "outline"} aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>Enter message</Button>
        <Button type="button" size="sm" variant={mode === "upload" ? "secondary" : "outline"} aria-pressed={mode === "upload"} onClick={() => setMode("upload")}>Upload RFQ file</Button>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} noValidate>
        {Object.keys(errors).length > 0 && <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-2 text-sm sm:col-span-2">{errors.form ?? "Please fix the highlighted fields."}</div>}
        {crmLeadId ? (
          <HelperText className="sm:col-span-2">Buyer and CRM lead come from the lead you started from.</HelperText>
        ) : (
          <>
            <Select label="Saved buyer" placeholder="Not in saved buyers" value={v.buyerCompanyId} onChange={set("buyerCompanyId")} options={(saved.data?.items ?? []).map((i) => ({ value: i.buyer.id, label: `${i.buyer.name}${i.buyer.demo ? " (sample)" : ""}` }))} />
            <Input label={mode === "manual" ? "Or buyer company name" : "Buyer company (optional)"} value={v.buyerName} onChange={set("buyerName")} disabled={Boolean(v.buyerCompanyId)} error={errors.buyerName} />
          </>
        )}
        <Input label={mode === "manual" ? "Subject" : "Subject (optional)"} required={mode === "manual"} value={v.subject} onChange={set("subject")} error={errors.subject} containerClassName="sm:col-span-2" />
        {mode === "upload" && (
          <div className="sm:col-span-2">
            <Input label="RFQ file" type="file" accept={ACCEPT} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} error={errors.file} description="PDF, Word, Excel, image, text, CSV or .eml — up to 10 MB. Text is read automatically from .txt/.csv/.eml only." />
            {progress !== null && <Progress value={progress} label={`Uploading ${progress}%`} className="mt-2" />}
          </div>
        )}
        <Textarea label={mode === "manual" ? "Buyer's message" : "Note / covering message (optional)"} required={mode === "manual"} rows={mode === "manual" ? 8 : 3} value={v.body} onChange={set("body")} error={errors.body} containerClassName="sm:col-span-2" description={mode === "manual" ? "Pasted HTML is converted to plain text; scripts and styles are removed." : undefined} />
        {mode === "manual" && (
          <>
            <Input label="Contact email (optional)" type="email" value={v.contactEmail} onChange={set("contactEmail")} error={errors.contactEmail} />
            <Select label="Market (optional)" placeholder="Not set" value={v.countryCode} onChange={set("countryCode")} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} />
            <Select label="Priority" placeholder="Medium (default)" value={v.priority} onChange={set("priority")} options={["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} />
          </>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? (mode === "upload" ? "Uploading…" : "Saving…") : mode === "upload" ? "Upload RFQ" : "Add inquiry"}</Button>
        </div>
      </form>
    </Modal>
  );
}
