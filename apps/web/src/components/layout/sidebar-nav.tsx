"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/navigation";
import { hasPermission } from "@/lib/permissions";
import { useSessionStore } from "@/lib/session-store";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

export interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

/**
 * The link list itself, shared between the persistent desktop sidebar
 * and the mobile Drawer — one navigation structure, two containers.
 */
export function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const session = useSessionStore((s) => s.session);
  const visibleItems = NAV_ITEMS.filter((item) => hasPermission(session, item.permission ?? ""));

  return (
    <TooltipProvider>
      <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          const link = (
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                collapsed && "justify-center px-2",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && (
                <span className="flex-1 truncate">{item.label}</span>
              )}
              {!collapsed && item.status === "placeholder" && (
                <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </Link>
          );

          return (
            <div key={item.href}>
              {collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link}
            </div>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
