import { PageTitle } from "@/components/ui/typography";
import { DashboardFoundationDemo } from "./dashboard-foundation-demo";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Dashboard</PageTitle>
      <DashboardFoundationDemo />
    </div>
  );
}
