import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center p-6">
      <EmptyState
        icon={ShieldAlert}
        title="Access denied"
        description="You don't have permission to view this page, or your session has ended."
        action={
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
        className="max-w-md"
      />
    </div>
  );
}
