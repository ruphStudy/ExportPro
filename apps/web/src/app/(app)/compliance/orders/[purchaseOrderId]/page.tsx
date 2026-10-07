"use client";

import { useParams } from "next/navigation";
import { ChecklistPage } from "@/components/compliance/checklist-page";
import { RequirePermission } from "@/components/layout/require-permission";

export default function OrderCompliancePage() {
  const { purchaseOrderId } = useParams<{ purchaseOrderId: string }>();
  return (
    <RequirePermission permission="compliance.view">
      <ChecklistPage anchor={{ purchaseOrderId }} />
    </RequirePermission>
  );
}
