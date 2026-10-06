"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { ExporterProfileSummary } from "@exportpro/types";
import { onboardingApi, productInterestsApi } from "@/lib/api/onboarding";
import { hasPermission } from "@/lib/permissions";
import { analyzeInterestHref } from "@/lib/product-labels";
import { useSession } from "@/lib/session";
import { referenceApi } from "@/lib/api/reference";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxCardGroup } from "@/components/ui/checkbox-card-group";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import { HelperText, SectionTitle } from "@/components/ui/typography";

const addSchema = z.object({
  name: z.string().min(1, "Enter a product name."),
  category: z.string().optional(),
  interestType: z.enum(["CURRENT", "INTERESTED"]),
});
type AddValues = z.infer<typeof addSchema>;

export function Step2Products({
  profile,
  onNext,
  onBack,
  canEdit,
}: {
  profile: ExporterProfileSummary;
  onNext: () => void;
  onBack: () => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canAnalyzeProduct = hasPermission(session, "products.analyze");
  const categories = useQuery({ queryKey: ["reference", "product-categories"], queryFn: referenceApi.productCategories });
  const interests = useQuery({ queryKey: ["onboarding", "products"], queryFn: productInterestsApi.list });
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>(profile.productCategories);
  const [removeTarget, setRemoveTarget] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddValues>({ resolver: zodResolver(addSchema), defaultValues: { interestType: "INTERESTED" } });

  const saveCategories = useMutation({
    mutationFn: () => onboardingApi.updateProducts({ productCategories: selectedCategories }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["onboarding"], updated);
      onNext();
    },
    onError: (error) => toast.error("Could not save", toFriendlyErrorMessage(error)),
  });

  const addInterest = useMutation({
    mutationFn: productInterestsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding", "products"] });
      reset({ name: "", category: undefined, interestType: "INTERESTED" });
    },
    onError: (error) => toast.error("Could not add product", toFriendlyErrorMessage(error)),
  });

  const removeInterest = useMutation({
    mutationFn: productInterestsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding", "products"] });
      setRemoveTarget(null);
    },
    onError: (error) => {
      toast.error("Could not remove product", toFriendlyErrorMessage(error));
      setRemoveTarget(null);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <SectionTitle>Product categories</SectionTitle>
        <HelperText>Select the categories you currently deal in or are interested in.</HelperText>
        {categories.isLoading ? (
          <TableSkeleton rows={2} columns={3} />
        ) : (
          <CheckboxCardGroup
            aria-label="Product categories"
            columns={3}
            options={(categories.data ?? []).map((c) => ({ value: c.code, label: c.label }))}
            value={selectedCategories}
            onChange={canEdit ? setSelectedCategories : () => undefined}
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>Product interests</SectionTitle>
        <HelperText>
          Add specific products — exact names, broad concepts, or category-only. We won&apos;t classify these legally; that
          comes later.
        </HelperText>

        {canEdit && (
          <form
            onSubmit={handleSubmit((values) => addInterest.mutate(values))}
            className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-end"
            noValidate
          >
            <Input
              label="Product name"
              placeholder="e.g. Cumin Seeds"
              required
              error={errors.name?.message}
              containerClassName="flex-1"
              {...register("name")}
            />
            <Select
              label="Category"
              placeholder="Optional"
              options={(categories.data ?? []).map((c) => ({ label: c.label, value: c.code }))}
              containerClassName="w-full sm:w-48"
              {...register("category")}
            />
            <Select
              label="Type"
              options={[
                { label: "Currently sell", value: "CURRENT" },
                { label: "Interested in", value: "INTERESTED" },
              ]}
              containerClassName="w-full sm:w-40"
              {...register("interestType")}
            />
            <Button type="submit" loading={isSubmitting || addInterest.isPending}>
              <Plus className="size-4" aria-hidden="true" />
              Add
            </Button>
          </form>
        )}

        {interests.isLoading ? (
          <TableSkeleton rows={3} columns={1} />
        ) : interests.data && interests.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {interests.data.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface p-3"
              >
                <div>
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  {item.category && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {categories.data?.find((c) => c.code === item.category)?.label ?? item.category}
                    </span>
                  )}
                  <Badge variant={item.interestType === "CURRENT" ? "success" : "info"} className="ml-2">
                    {item.interestType === "CURRENT" ? "Currently sell" : "Interested"}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.productId ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/products/${item.productId}`}>View product</Link>
                    </Button>
                  ) : (
                    canAnalyzeProduct && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={analyzeInterestHref(item)} aria-label={`Analyze ${item.name}`}>
                          <Sparkles className="size-3.5" aria-hidden="true" />
                          Analyze
                        </Link>
                      </Button>
                    )
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="icon" aria-label={`Remove ${item.name}`} onClick={() => setRemoveTarget(item.id)}>
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No products added yet" description="Add at least one product to improve your readiness score." />
        )}
      </div>

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {canEdit && (
          <Button onClick={() => saveCategories.mutate()} loading={saveCategories.isPending}>
            Save &amp; Continue
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove product"
        confirmLabel="Remove"
        destructive
        loading={removeInterest.isPending}
        onConfirm={() => removeTarget && removeInterest.mutate(removeTarget)}
      />
    </div>
  );
}
