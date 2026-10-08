"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ActionPriority, Permission } from "@exportpro/types";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const PRIORITY: Record<ActionPriority, { label: string; variant: "danger" | "warning" | "info" | "neutral"; icon: string }> = {
  CRITICAL: { label: "Critical", variant: "danger", icon: "‼" },
  HIGH: { label: "High", variant: "warning", icon: "!" },
  MEDIUM: { label: "Medium", variant: "info", icon: "•" },
  LOW: { label: "Low", variant: "neutral", icon: "·" },
};

/** Text + symbol so priority is never conveyed by colour alone. */
export function PriorityBadge({ p }: { p: ActionPriority }) {
  return <Badge variant={PRIORITY[p].variant}><span aria-hidden="true">{PRIORITY[p].icon} </span>{PRIORITY[p].label}</Badge>;
}

export const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function useCan() {
  const { data: session } = useSession();
  return (p: Permission) => hasPermission(session, p);
}

export function ActionTabs() {
  const pathname = usePathname();
  const can = useCan();
  const tabs = [
    { href: "/action-center", label: "Needs your attention", perm: "action_center.view" as Permission },
    { href: "/automation", label: "Automation rules", perm: "automation.view" as Permission },
  ].filter((t) => can(t.perm));
  return (
    <nav aria-label="Action Center sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <li key={t.href}><Button asChild size="sm" variant={pathname === t.href ? "secondary" : "ghost"}><Link href={t.href} aria-current={pathname === t.href ? "page" : undefined}>{t.label}</Link></Button></li>
        ))}
      </ul>
    </nav>
  );
}

export function useOpsMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ops"] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409 && /changed by someone/i.test(e.message)) {
        toast.error("This item changed", "It was updated elsewhere — the latest version has been loaded.");
        qc.invalidateQueries({ queryKey: ["ops"] });
      } else toast.error("Action failed", toFriendlyErrorMessage(e));
    },
  });
}
