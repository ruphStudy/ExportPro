"use client";

import { PanelLeftClose, PanelLeftOpen, Ship } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./sidebar-nav";

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/** Persistent desktop sidebar. Hidden below `md`; the mobile equivalent is this same SidebarNav rendered inside a Drawer from TopNav. */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden">
          <Ship className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {!collapsed && <span className="truncate text-sm font-semibold text-foreground">ExportPro</span>}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <SidebarNav collapsed={collapsed} />
      </div>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-2",
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
