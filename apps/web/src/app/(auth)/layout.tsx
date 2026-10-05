import { Ship } from "lucide-react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link href="/login" className="mb-6 flex items-center gap-2">
        <Ship className="size-6 text-primary" aria-hidden="true" />
        <span className="text-lg font-semibold text-foreground">ExportPro</span>
      </Link>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm sm:max-w-md sm:p-8">
        {children}
      </div>
    </div>
  );
}
