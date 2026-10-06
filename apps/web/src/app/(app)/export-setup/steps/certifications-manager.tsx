"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { certificationsApi } from "@/lib/api/onboarding";
import { referenceApi } from "@/lib/api/reference";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { VERIFICATION_STATUS_LABELS } from "@/lib/verification-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { HelperText, SectionTitle } from "@/components/ui/typography";

const schema = z.object({
  type: z.string().min(1, "Select a certificate type."),
  name: z.string().min(1, "Enter a certificate name."),
  number: z.string().optional(),
  issuer: z.string().optional(),
  expiryDate: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function CertificationsManager({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: ["reference", "certification-types"], queryFn: referenceApi.certificationTypes });
  const certifications = useQuery({ queryKey: ["onboarding", "certifications"], queryFn: certificationsApi.list });
  const [addOpen, setAddOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<string | null>(null);
  const fileInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["onboarding", "certifications"] });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const create = useMutation({
    mutationFn: certificationsApi.create,
    onSuccess: () => {
      toast.success("Certificate added");
      invalidate();
      setAddOpen(false);
      reset();
    },
    onError: (error) => toast.error("Could not add certificate", toFriendlyErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: certificationsApi.remove,
    onSuccess: () => {
      toast.success("Certificate removed");
      invalidate();
      setRemoveTarget(null);
    },
    onError: (error) => {
      toast.error("Could not remove certificate", toFriendlyErrorMessage(error));
      setRemoveTarget(null);
    },
  });

  const uploadDoc = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => certificationsApi.uploadDocument(id, file),
    onSuccess: () => {
      toast.success("Document uploaded");
      invalidate();
    },
    onError: (error) => toast.error("Upload failed", toFriendlyErrorMessage(error)),
  });

  const removeDoc = useMutation({
    mutationFn: certificationsApi.removeDocument,
    onSuccess: () => {
      toast.success("Document removed");
      invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>Certifications</SectionTitle>
          <HelperText>ISO, HACCP, Organic, or any other certificate relevant to your products.</HelperText>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add certificate
          </Button>
        )}
      </div>

      {certifications.isLoading ? (
        <TableSkeleton rows={2} columns={1} />
      ) : certifications.data && certifications.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {certifications.data.map((cert) => {
            const verification = VERIFICATION_STATUS_LABELS[cert.verificationStatus];
            const doc = cert.documents[0];
            return (
              <li key={cert.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{cert.name}</span>
                      <Badge variant="neutral">{cert.type}</Badge>
                      <Badge variant={verification.variant}>{verification.label}</Badge>
                      {cert.status === "EXPIRED" && <Badge variant="danger">Expired</Badge>}
                    </div>
                    <HelperText className="mt-1">
                      {cert.number && `No. ${cert.number} · `}
                      {cert.issuer && `${cert.issuer} · `}
                      {cert.expiryDate ? `Expires ${new Date(cert.expiryDate).toLocaleDateString()}` : "No expiry date set"}
                    </HelperText>
                  </div>
                  {canEdit && (
                    <Button variant="ghost" size="icon" aria-label={`Remove ${cert.name}`} onClick={() => setRemoveTarget(cert.id)}>
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  )}
                </div>

                {doc ? (
                  <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <a href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                      <FileText className="size-4" aria-hidden="true" />
                      {doc.originalFilename}
                    </a>
                    {canEdit && (
                      <Button variant="ghost" size="icon" aria-label="Remove document" onClick={() => removeDoc.mutate(doc.id)}>
                        <Trash2 className="size-4 text-danger" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ) : (
                  canEdit && (
                    <div>
                      <input
                        ref={(el) => {
                          fileInputRefs.current[cert.id] = el;
                        }}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadDoc.mutate({ id: cert.id, file });
                          e.target.value = "";
                        }}
                      />
                      <Button variant="outline" size="sm" onClick={() => fileInputRefs.current[cert.id]?.click()}>
                        <Upload className="size-4" aria-hidden="true" />
                        Upload document
                      </Button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No certificates added yet" description="Certificates strengthen your readiness profile." />
      )}

      <Modal open={addOpen} onOpenChange={setAddOpen} title="Add certificate">
        <form onSubmit={handleSubmit((values) => create.mutate(values))} className="flex flex-col gap-4" noValidate>
          <Select
            label="Type"
            required
            placeholder="Select type"
            options={(types.data ?? []).map((t) => ({ label: t.label, value: t.code }))}
            error={errors.type?.message}
            {...register("type")}
          />
          <Input label="Certificate name" required placeholder="e.g. USDA Organic" error={errors.name?.message} {...register("name")} />
          <Input label="Certificate number" {...register("number")} />
          <Input label="Issuing authority" {...register("issuer")} />
          <Input label="Expiry date" type="date" {...register("expiryDate")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || create.isPending}>
              Add
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove certificate"
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget)}
      />
    </div>
  );
}
