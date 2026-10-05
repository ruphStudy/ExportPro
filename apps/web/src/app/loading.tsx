import { PageSkeleton } from "@/components/ui/skeleton";

export default function GlobalLoading() {
  return (
    <div className="flex-1 p-6">
      <PageSkeleton />
    </div>
  );
}
