"use client";

import { useParams } from "next/navigation";
import { ChecklistPage } from "@/components/compliance/checklist-page";
import { RequirePermission } from "@/components/layout/require-permission";

export default function ProvisionalCompliancePage() {
  const { quotationId } = useParams<{ quotationId: string }>();
  return (
    <RequirePermission permission="compliance.view">
      <ChecklistPage anchor={{ quotationId }} />
    </RequirePermission>
  );
}
