"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2, Upload } from "lucide-react";
import * as React from "react";
import type { RegistrationSummary, RegistrationType } from "@exportpro/types";
import { registrationsApi } from "@/lib/api/onboarding";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { VERIFICATION_STATUS_LABELS } from "@/lib/verification-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CardTitle, HelperText } from "@/components/ui/typography";

const STATUS_OPTIONS = [
  { label: "Not applied", value: "NOT_APPLIED" },
  { label: "Applied / pending", value: "APPLIED_PENDING" },
  { label: "Available", value: "AVAILABLE" },
  { label: "Not applicable", value: "NOT_APPLICABLE" },
  { label: "Not sure", value: "NOT_SURE" },
];

export function RegistrationCard({
  type,
  title,
  description,
  registration,
  canEdit,
}: {
  type: RegistrationType;
  title: string;
  description: string;
  registration?: RegistrationSummary;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [status, setStatus] = React.useState(registration?.status ?? "NOT_SURE");
  const [number, setNumber] = React.useState(registration?.number ?? "");
  const [expiryDate, setExpiryDate] = React.useState(registration?.expiryDate?.slice(0, 10) ?? "");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["onboarding", "registrations"] });

  const save = useMutation({
    mutationFn: () => registrationsApi.upsert(type, { status: status as never, number: number || undefined, expiryDate: expiryDate || undefined }),
    onSuccess: () => {
      toast.success(`${title} updated`);
      invalidate();
    },
    onError: (error) => toast.error("Could not save", toFriendlyErrorMessage(error)),
  });

  const uploadDoc = useMutation({
    mutationFn: (file: File) => registrationsApi.uploadDocument(type, file),
    onSuccess: () => {
      toast.success("Document uploaded");
      invalidate();
    },
    onError: (error) => toast.error("Upload failed", toFriendlyErrorMessage(error)),
  });

  const removeDoc = useMutation({
    mutationFn: (documentId: string) => registrationsApi.removeDocument(documentId),
    onSuccess: () => {
      toast.success("Document removed");
      invalidate();
    },
    onError: (error) => toast.error("Could not remove document", toFriendlyErrorMessage(error)),
  });

  const verification = VERIFICATION_STATUS_LABELS[registration?.verificationStatus ?? "NOT_PROVIDED"];
  const document = registration?.documents[0];

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          <HelperText className="mt-0.5">{description}</HelperText>
        </div>
        <Badge variant={verification.variant}>{verification.label}</Badge>
      </div>

      <CardContent className="flex flex-col gap-3 px-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Status"
            disabled={!canEdit}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            options={STATUS_OPTIONS}
          />
          <Input
            label="Number"
            disabled={!canEdit}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="If available"
          />
          <Input
            label="Expiry date"
            type="date"
            disabled={!canEdit}
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
        </div>

        {canEdit && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => save.mutate()} loading={save.isPending}>
              Save
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadDoc.mutate(file);
                e.target.value = "";
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} loading={uploadDoc.isPending}>
              <Upload className="size-4" aria-hidden="true" />
              {document ? "Replace document" : "Upload document"}
            </Button>
          </div>
        )}

        {document && (
          <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
            <a
              href={document.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-primary hover:underline"
            >
              <FileText className="size-4" aria-hidden="true" />
              {document.originalFilename}
            </a>
            {canEdit && (
              <Button variant="ghost" size="icon" aria-label="Remove document" onClick={() => removeDoc.mutate(document.id)}>
                <Trash2 className="size-4 text-danger" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
