"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RuleProvenance } from "@exportpro/types";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Caption } from "@/components/ui/typography";

/** Section switcher: compliance checklists ↔ document workspace. */
export function ComplianceSectionTabs() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const tabs = [
    { href: "/compliance", label: "Compliance", show: hasPermission(session, "compliance.view") },
    { href: "/documents", label: "Documents", show: hasPermission(session, "documents.view") },
    { href: "/documents/validation", label: "Validation", show: hasPermission(session, "document_validation.view") },
    { href: "/documents/templates", label: "Templates", show: hasPermission(session, "documents.approve") },
  ].filter((t) => t.show);
  return (
    <nav aria-label="Documents and compliance" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const active = t.href === "/documents" ? pathname === "/documents" : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Button asChild size="sm" variant={active ? "secondary" : "ghost"}>
                <Link href={t.href} aria-current={active ? "page" : undefined}>{t.label}</Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mutation helper: invalidates compliance + document queries; friendly errors (incl. validation problem lists). */
export function useComplianceMutation<A, R>(fn: (a: A) => Promise<R>, success?: string, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      if (success) toast.success(success);
      onDone?.(r);
    },
    onError: (e) => {
      const problems = e instanceof ApiRequestError ? (e.details as { problems?: unknown[] } | undefined)?.problems : undefined;
      const list = Array.isArray(problems) ? problems.map((p) => (typeof p === "string" ? p : (p as { name?: string }).name ?? "")).filter(Boolean) : [];
      toast.error(e instanceof ApiRequestError ? e.message : "Action failed", list.length ? list.join(" · ") : toFriendlyErrorMessage(e));
      if (e instanceof ApiRequestError && e.status === 409) {
        qc.invalidateQueries({ queryKey: ["compliance"] });
        qc.invalidateQueries({ queryKey: ["documents"] });
      }
    },
  });
}

/** Source provenance line (source, link, dates, confidence, staleness). */
export function Provenance({ p }: { p: RuleProvenance }) {
  return (
    <Caption className="block">
      Source: {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">{p.sourceName}</a> : p.sourceName}
      {" · "}
      {p.sourceType.replace(/_/g, " ").toLowerCase()}
      {p.lastCheckedAt ? ` · last reviewed ${p.lastCheckedAt}` : ""}
      {p.effectiveFrom ? ` · effective ${p.effectiveFrom}` : ""}
      {` · confidence ${p.confidence.toLowerCase()}`}
      {p.stale && <span className="text-warning"> · Requirement source may need reconfirmation.</span>}
    </Caption>
  );
}
