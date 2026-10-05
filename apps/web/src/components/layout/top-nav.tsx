"use client";

import { useMutation } from "@tanstack/react-query";
import { Bell, Building2, Check, LogOut, Menu, Settings, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { authApi } from "@/lib/api/auth";
import { organizationsApi } from "@/lib/api/organizations";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { useClearSession, useInvalidateSession, useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
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
  const router = useRouter();
  const { data: session } = useSession();
  const invalidateSession = useInvalidateSession();
  const clearSession = useClearSession();
  const [search, setSearch] = React.useState("");

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      clearSession();
      router.push("/login");
    },
    onError: (error) => toast.error("Could not sign out", toFriendlyErrorMessage(error)),
  });

  const switchOrg = useMutation({
    mutationFn: organizationsApi.switch,
    onSuccess: () => {
      invalidateSession();
      toast.success("Switched organization");
      router.push("/dashboard");
    },
    onError: (error) => toast.error("Could not switch organization", toFriendlyErrorMessage(error)),
  });

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

  const currentMembership = session?.memberships.find((m) => m.organization.id === session.activeOrganizationId);

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

      {currentMembership && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="hidden max-w-48 sm:flex">
              <Building2 className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{currentMembership.organization.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {session?.memberships.map((m) => (
              <DropdownMenuItem
                key={m.organization.id}
                onSelect={() => {
                  if (m.organization.id !== session.activeOrganizationId) {
                    switchOrg.mutate({ organizationId: m.organization.id });
                  }
                }}
              >
                {m.organization.id === session?.activeOrganizationId ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <span className="size-4" />
                )}
                <span className="truncate">{m.organization.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
            <DropdownMenuItem onSelect={() => router.push("/profile")}>
              <UserRound className="size-4" aria-hidden="true" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/settings")}>
              <Settings className="size-4" aria-hidden="true" />
              Organization settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
              <LogOut className="size-4" aria-hidden="true" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
