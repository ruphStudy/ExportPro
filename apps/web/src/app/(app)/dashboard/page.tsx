import { PageTitle } from "@/components/ui/typography";
import { CrmFollowUpSummary } from "./crm-follow-up-summary";
import { DashboardFoundationDemo } from "./dashboard-foundation-demo";
import { ExportReadinessSummary } from "./export-readiness-summary";
import { NeedsAttention } from "./needs-attention";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Dashboard</PageTitle>
      <NeedsAttention />
      <ExportReadinessSummary />
      <CrmFollowUpSummary />
      <DashboardFoundationDemo />
    </div>
  );
}
