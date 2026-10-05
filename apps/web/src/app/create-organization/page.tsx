"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ship } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BusinessType, TradeDirection } from "@exportpro/types";
import { organizationsApi } from "@/lib/api/organizations";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { SESSION_QUERY_KEY, useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/skeleton";
import { HelperText, PageTitle } from "@/components/ui/typography";

const schema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters."),
  businessType: z.enum(BusinessType, { message: "Select a business type." }),
  industry: z.string().optional(),
  exports: z.boolean().optional(),
  imports: z.boolean().optional(),
});
type Values = z.infer<typeof schema>;

const BUSINESS_TYPE_OPTIONS = [
  { label: "Manufacturer", value: BusinessType.MANUFACTURER },
  { label: "Merchant Exporter", value: BusinessType.MERCHANT_EXPORTER },
  { label: "Trader", value: BusinessType.TRADER },
  { label: "Importer", value: BusinessType.IMPORTER },
  { label: "Exporter & Importer", value: BusinessType.EXPORTER_IMPORTER },
];

export default function CreateOrganizationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isLoading, isError } = useSession();

  React.useEffect(() => {
    if (isLoading) return;
    if (isError || !session) {
      router.replace("/login?returnTo=/create-organization");
    } else if (session.activeOrganizationId) {
      router.replace("/dashboard");
    }
  }, [isLoading, isError, session, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { exports: true, imports: false } });

  const create = useMutation({
    mutationFn: (values: Values) =>
      organizationsApi.create({
        name: values.name,
        businessType: values.businessType,
        industry: values.industry || undefined,
        tradeDirections: [
          ...(values.exports ? [TradeDirection.EXPORT] : []),
          ...(values.imports ? [TradeDirection.IMPORT] : []),
        ],
      }),
    onSuccess: (newSession) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, newSession);
      router.push("/dashboard");
    },
  });

  if (isLoading || isError || !session || session.activeOrganizationId) return <PageSkeleton />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <Ship className="size-6 text-primary" aria-hidden="true" />
        <span className="text-lg font-semibold text-foreground">ExportPro</span>
      </div>

      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8">
        <PageTitle>Set up your company</PageTitle>
        <HelperText className="mt-1">
          Welcome, {session.user.firstName}. Tell us about your business to get started.
        </HelperText>

        <form
          onSubmit={handleSubmit((values) => create.mutate(values))}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
          <Input
            label="Company name"
            required
            placeholder="e.g. Ada Exports Pvt Ltd"
            error={errors.name?.message}
            {...register("name")}
          />
          <Select
            label="Business type"
            placeholder="Select business type"
            required
            options={BUSINESS_TYPE_OPTIONS}
            error={errors.businessType?.message}
            {...register("businessType")}
          />
          <Input label="Industry" placeholder="e.g. Textiles, Agriculture, Machinery" {...register("industry")} />

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-foreground">Trade direction</span>
            <Checkbox label="Export" {...register("exports")} />
            <Checkbox label="Import" {...register("imports")} />
          </div>

          {create.isError && (
            <p role="alert" className="text-sm text-danger">
              {toFriendlyErrorMessage(create.error)}
            </p>
          )}

          <Button type="submit" loading={isSubmitting || create.isPending} className="mt-2">
            Create company
          </Button>
        </form>
      </div>
    </div>
  );
}
