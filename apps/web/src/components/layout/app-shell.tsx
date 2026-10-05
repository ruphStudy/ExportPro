"use client";

import { usePathname } from "next/navigation";
import * as React from "react";
import { findNavItemByPath } from "@/lib/navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Drawer } from "@/components/ui/drawer";
import { Sidebar } from "./sidebar";
import { SidebarNav } from "./sidebar-nav";
import { TopNav } from "./top-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const activeItem = findNavItemByPath(pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />

      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen} title="ExportPro" side="left">
        <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Breadcrumbs
            className="mb-4"
            items={[
              { label: "Home", href: "/dashboard" },
              { label: activeItem?.label ?? "Page" },
            ]}
          />
          {children}
        </main>
      </div>
    </div>
  );
}
