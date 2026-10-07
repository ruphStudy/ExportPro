"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { COUNTRIES, INCOTERM_ORDER } from "@exportpro/types";
import { costingApi, currencyOptions } from "@/lib/api/costing";
import { productsApi } from "@/lib/api/products";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { RequirePermission } from "@/components/layout/require-permission";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

const schema = z.object({
  name: z.string().max(120).optional(),
  productId: z.string().optional(),
  destinationCountryCode: z.string().optional(),
  quantity: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, "Enter a positive quantity (up to 4 decimals).").refine((v) => Number(v) > 0, "Quantity must be greater than zero."),
  quantityUnit: z.enum(["KG", "MT", "UNIT", "CARTON", "CONTAINER"]),
  calculationCurrency: z.string().length(3),
  quoteCurrency: z.string().length(3),
  incoterm: z.enum(["EXW", "FCA", "FOB", "CFR", "CIF"]),
  incotermPlace: z.string().max(80).optional(),
});
type Values = z.infer<typeof schema>;

export default function NewCostingPage() {
  return (
    <RequirePermission permission="costing.create">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NewCosting />
      </Suspense>
    </RequirePermission>
  );
}

function NewCosting() {
  const router = useRouter();
  const sp = useSearchParams();
  const buyerCompanyId = sp.get("buyerCompanyId") ?? undefined;
  const crmLeadId = sp.get("crmLeadId") ?? undefined;
  const products = useQuery({ queryKey: ["products", "costing-picker"], queryFn: () => productsApi.list({ pageSize: 100 }) });
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: sp.get("productId") ?? "",
      destinationCountryCode: sp.get("country") ?? "",
      quantity: sp.get("quantity") ?? "",
      quantityUnit: (sp.get("unit") as Values["quantityUnit"]) ?? "MT",
      calculationCurrency: "INR",
      quoteCurrency: "USD",
      incoterm: "FOB",
    },
  });
  const create = useMutation({
    mutationFn: (v: Values) =>
      costingApi.create({
        ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined)),
        buyerCompanyId,
        crmLeadId,
      }),
    onSuccess: (c) => {
      toast.success(`Costing ${c.reference} created`);
      router.push(`/costing/${c.id}`);
    },
    onError: (e) => toast.error("Could not create costing", toFriendlyErrorMessage(e)),
  });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Breadcrumbs items={[{ label: "Export Costing", href: "/costing" }, { label: "New costing" }]} />
      <div>
        <PageTitle>New export costing</PageTitle>
        <HelperText className="mt-1">
          Set the context and quantity. You’ll add procurement, export, freight and financial costs next. {crmLeadId ? "Buyer, product and market are prefilled from the CRM lead." : buyerCompanyId ? "Linked to the selected buyer." : ""}
        </HelperText>
      </div>
      <Card className="p-4">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
          <Input label="Name (optional)" placeholder="Defaults to product → market" containerClassName="sm:col-span-2" error={errors.name?.message} {...register("name")} />
          <Select label="Product" placeholder={crmLeadId ? "From CRM lead" : "Not linked yet"} options={(products.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.displayName} (${p.itcHsCode ?? p.hsCode})` }))} {...register("productId")} description="Required before the costing can be marked ready." />
          <Select label="Destination market" placeholder={crmLeadId ? "From CRM lead" : "Select country"} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} {...register("destinationCountryCode")} />
          <Input label="Quantity" required inputMode="decimal" error={errors.quantity?.message} {...register("quantity")} />
          <Select label="Quantity unit" required options={["KG", "MT", "UNIT", "CARTON", "CONTAINER"].map((u) => ({ value: u, label: u }))} {...register("quantityUnit")} description="Only KG↔MT is converted automatically." />
          <Select label="Calculation currency" required options={currencyOptions} {...register("calculationCurrency")} description="All costs are normalized to this currency." />
          <Select label="Quote currency" required options={currencyOptions} {...register("quoteCurrency")} description="Currency shown to the buyer." />
          <Select label="Target Incoterm®" required options={INCOTERM_ORDER.map((t) => ({ value: t, label: t }))} {...register("incoterm")} />
          <Input label="Named place" placeholder="e.g. Mundra" {...register("incotermPlace")} />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create costing"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
