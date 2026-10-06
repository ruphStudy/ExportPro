import { PageTitle } from "@/components/ui/typography";
import { DashboardFoundationDemo } from "./dashboard-foundation-demo";
import { ExportReadinessSummary } from "./export-readiness-summary";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Dashboard</PageTitle>
      <ExportReadinessSummary />
      <DashboardFoundationDemo />
    </div>
  );
}
