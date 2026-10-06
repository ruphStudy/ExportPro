"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatTariffCode } from "@exportpro/types";
import { productAnalysisApi } from "@/lib/api/products";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Caption, HelperText, SectionTitle } from "@/components/ui/typography";

export function RecentAnalyses() {
  const recent = useQuery({ queryKey: ["product-analysis", "recent"], queryFn: productAnalysisApi.recent });

  return (
    <Card className="p-4">
      <SectionTitle className="text-sm">Recent analyses</SectionTitle>
      {recent.isLoading ? (
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : recent.isError ? (
        <HelperText className="mt-2">Couldn&apos;t load recent analyses.</HelperText>
      ) : !recent.data?.length ? (
        <HelperText className="mt-2">No analyses yet.</HelperText>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {recent.data.map((a) => (
            <li key={a.id}>
              <Link
                href={`/products/analyze/${a.id}`}
                className="flex flex-col gap-0.5 rounded-md p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex flex-wrap items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium text-foreground">{a.normalizedProductName}</span>
                  {a.status === "CONFIRMED" ? (
                    <Badge variant="success">Confirmed</Badge>
                  ) : (
                    <Badge variant="warning">Needs review</Badge>
                  )}
                </span>
                <Caption>
                  {a.primaryCode ? formatTariffCode(a.primaryCode) : "No code yet"} · {new Date(a.createdAt).toLocaleDateString()}
                </Caption>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
