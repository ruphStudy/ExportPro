"use client";

import { Bell, LogOut, Menu, Settings, UserRound } from "lucide-react";
import * as React from "react";
import { toast } from "@/lib/toast";
import { useSessionStore } from "@/lib/session-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";

export interface TopNavProps {
  onOpenMobileNav: () => void;
}

export function TopNav({ onOpenMobileNav }: TopNavProps) {
  const session = useSessionStore((s) => s.session);
  const [search, setSearch] = React.useState("");

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (search.trim().length === 0) return;
    toast.info("Global search is coming soon", `We'll search across your workspace for "${search}".`);
  };

  const initials = session?.user.fullName
    ? session.user.fullName
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>

      <form onSubmit={handleSearchSubmit} className="max-w-sm flex-1">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search opportunities, buyers, products..."
          aria-label="Global search"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="size-5" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              description="We'll let you know here when something needs your attention."
              className="border-none p-4"
            />
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Account menu"
            >
              {initials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {session?.user.fullName}
              <div className="mt-0.5 truncate text-xs font-normal text-muted-foreground">{session?.user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => toast.info("Profile editing arrives with Sprint 2 authentication.")}>
              <UserRound className="size-4" aria-hidden="true" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.info("Organization settings arrive with Sprint 2.")}>
              <Settings className="size-4" aria-hidden="true" />
              Organization settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => toast.info("Sign-in/out isn't wired up until Sprint 2's authentication.")}>
              <LogOut className="size-4" aria-hidden="true" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
