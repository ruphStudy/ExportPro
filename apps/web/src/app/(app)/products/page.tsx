"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Package, Plus, RotateCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { formatTariffCode, type ProductSummary } from "@exportpro/types";
import { productInterestsApi } from "@/lib/api/onboarding";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import {
  analyzeInterestHref,
  categoryLabel,
  CLASSIFICATION_SOURCE_LABELS,
  CLASSIFICATION_STATUS_LABELS,
  CODE_SYSTEM_LABELS,
} from "@/lib/product-labels";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { ConfidenceBadge } from "@/components/products/classification-bits";
import { RecentAnalyses } from "@/components/products/recent-analyses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/table";
import { Caption, HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

export default function ProductsPage() {
  return (
    <RequirePermission permission="products.view">
      <ProductsContent />
    </RequirePermission>
  );
}

function ProductsContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const canAnalyze = hasPermission(session, "products.analyze");
  const canConfirm = hasPermission(session, "products.confirm_classification");
  const [q, setQ] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const products = useQuery({
    queryKey: ["products", "list", term, page],
    queryFn: () => productsApi.list({ q: term || undefined, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const interests = useQuery({
    queryKey: ["onboarding", "products"],
    queryFn: productInterestsApi.list,
    enabled: canAnalyze && hasPermission(session, "onboarding.view"),
  });
  const pendingInterests = (interests.data ?? []).filter((i) => !i.productId);

  const reanalyze = useMutation({
    mutationFn: productsApi.reanalyze,
    onSuccess: (analysis) => router.push(`/products/analyze/${analysis.id}`),
    onError: (error) => toast.error("Could not start re-analysis", toFriendlyErrorMessage(error)),
  });

  const columns: Column<ProductSummary>[] = [
    {
      key: "name",
      header: "Product",
      render: (p) => (
        <div className="flex max-w-[16rem] flex-col">
          <Link href={`/products/${p.id}`} className="truncate font-medium text-foreground hover:underline">
            {p.displayName}
          </Link>
          <Caption>{categoryLabel(p.categoryCode)}</Caption>
        </div>
      ),
    },
    {
      key: "code",
      header: "Classification",
      render: (p) => (
        <div className="flex flex-col">
          <span className="font-mono text-sm">{formatTariffCode(p.classificationCode)}</span>
          <Caption>{CODE_SYSTEM_LABELS[p.codeSystem]}</Caption>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => {
        const s = CLASSIFICATION_STATUS_LABELS[p.classificationStatus];
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={s.variant}>{s.label}</Badge>
            <Caption>{CLASSIFICATION_SOURCE_LABELS[p.classificationSource]}</Caption>
          </div>
        );
      },
    },
    { key: "confidence", header: "Confidence", hideOnMobile: true, render: (p) => <ConfidenceBadge confidence={p.classificationConfidence} /> },
    { key: "updated", header: "Last updated", hideOnMobile: true, render: (p) => new Date(p.updatedAt).toLocaleDateString() },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/products/${p.id}`}>View</Link>
          </Button>
          {canAnalyze && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reanalyze.mutate(p.id)}
              disabled={reanalyze.isPending}
              aria-label={`Re-analyze ${p.displayName}`}
            >
              <RotateCw className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Re-analyze</span>
            </Button>
          )}
          {canConfirm && (
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link href={`/products/${p.id}?change=classification`}>Change classification</Link>
            </Button>
          )}
        </div>
      ),
    },
  ];

  const isEmpty = !term && products.data?.items.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageTitle>My Products</PageTitle>
          <HelperText className="mt-1">Saved products with a classification confirmed for platform analysis.</HelperText>
        </div>
        {canAnalyze && (
          <Button asChild>
            <Link href="/products/analyze">
              <Sparkles className="size-4" aria-hidden="true" />
              Analyze Product
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {!isEmpty && (
            <SearchInput
              aria-label="Search products by name or code"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              loading={products.isFetching && !products.isLoading}
              placeholder="Search by product name or code"
            />
          )}
          <DataTable
            columns={columns}
            rows={products.data?.items ?? []}
            rowKey={(p) => p.id}
            isLoading={products.isLoading}
            error={products.isError ? toFriendlyErrorMessage(products.error) : undefined}
            onRetry={() => products.refetch()}
            emptyState={
              term
                ? { title: "No matching products", description: "Try a different name or code." }
                : {
                    icon: Package,
                    title: "No saved products yet",
                    description: "Analyze a product, review its classification and confirm it to save it here.",
                    action: canAnalyze ? (
                      <Button asChild>
                        <Link href="/products/analyze">Analyze your first product</Link>
                      </Button>
                    ) : undefined,
                  }
            }
          />
          {products.data && products.data.meta.totalPages > 1 && <Pagination meta={products.data.meta} onPageChange={setPage} />}
        </div>

        <div className="flex flex-col gap-4">
          {canAnalyze && pendingInterests.length > 0 && (
            <Card className="p-4">
              <SectionTitle className="text-sm">From your Export Setup</SectionTitle>
              <HelperText className="mt-1">Product interests not yet classified.</HelperText>
              <ul className="mt-3 flex flex-col gap-2">
                {pendingInterests.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-foreground">{i.name}</span>
                    <Button asChild variant="outline" size="sm">
                      <Link href={analyzeInterestHref(i)} aria-label={`Analyze ${i.name}`}>
                        <Plus className="size-3.5" aria-hidden="true" />
                        Analyze
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {canAnalyze && <RecentAnalyses />}
        </div>
      </div>
    </div>
  );
}
