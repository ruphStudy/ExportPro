"use client";

import Link from "next/link";
import * as React from "react";
import type { MissingDocumentRow } from "@exportpro/types";
import { MISSING_STATE, PARTY, VALIDATION_STATUS } from "@/lib/compliance-labels";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { UploadDocumentDialog, type UploadDefaults } from "@/components/compliance/upload-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Caption } from "@/components/ui/typography";

/** Expected documents (from the Sprint 16 checklist) with actionable next steps — no dead buttons. */
export function MissingDocumentsList({ rows, purchaseOrderId }: { rows: MissingDocumentRow[]; purchaseOrderId: string }) {
  const { data: session } = useSession();
  const [upload, setUpload] = React.useState<UploadDefaults | null>(null);
  const canUpload = hasPermission(session, "documents.upload");
  const canPrepare = hasPermission(session, "documents.generate") || hasPermission(session, "documents.edit_logistics");
  return (
    <>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.documentType} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-2">
            <div className="min-w-0">
              <p className="font-medium">{r.label}</p>
              <Caption className="block">{r.requirementName} · {r.level.toLowerCase()} · {r.basis.replace(/_/g, " ").toLowerCase()} · provided by {(PARTY as Record<string, string>)[r.responsibleParty] ?? r.responsibleParty}</Caption>
              <Caption className="block">{r.reason}</Caption>
              {r.document && <Caption className="block"><Link className="text-primary hover:underline" href={`/documents/${r.document.id}`}>{r.document.title}</Link> · validation: {VALIDATION_STATUS[r.document.validationStatus].label}</Caption>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant={MISSING_STATE[r.state].variant}>{MISSING_STATE[r.state].label}</Badge>
              {r.state === "MISSING_NOW" && (r.generatable ? canPrepare && <Button asChild size="sm" variant="outline"><Link href={`/documents?generate=1&purchaseOrderId=${purchaseOrderId}&documentType=${r.documentType}`}>Prepare</Link></Button> : canUpload && <Button size="sm" variant="outline" onClick={() => setUpload({ documentType: r.documentType, allowedTypes: [r.documentType], purchaseOrderId, requirementId: r.requirementId ?? undefined, requirementName: r.requirementName })}>Upload</Button>)}
              {r.requirementId && <Link className="text-xs text-primary hover:underline" href={`/compliance/orders/${purchaseOrderId}#req-${r.requirementId}`}>View requirement</Link>}
            </div>
          </li>
        ))}
      </ul>
      {upload && <UploadDocumentDialog open onClose={() => setUpload(null)} defaults={upload} />}
    </>
  );
}
