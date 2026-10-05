"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ImagePlus, Trash2 } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BusinessType } from "@exportpro/types";
import { organizationsApi } from "@/lib/api/organizations";
import { toFriendlyErrorMessage } from "@/lib/api-client";
import { hasPermission } from "@/lib/permissions";
import { useInvalidateSession, useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ErrorState } from "@/components/ui/error-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelperText, PageTitle, SectionTitle } from "@/components/ui/typography";

const BUSINESS_TYPE_OPTIONS = Object.values(BusinessType).map((value) => ({
  label: value.replace("_", " "),
  value,
}));

const schema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters."),
  legalName: z.string().optional(),
  businessType: z.enum(BusinessType).optional(),
  industry: z.string().optional(),
  website: z.string().url("Enter a valid URL.").or(z.literal("")).optional(),
  email: z.string().email("Enter a valid email.").or(z.literal("")).optional(),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  defaultCurrency: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function OrganizationSettingsPage() {
  const { data: session } = useSession();
  const canUpdate = hasPermission(session, "organization.update");
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();
  const [removeLogoOpen, setRemoveLogoOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const organization = useQuery({ queryKey: ["organization", "current"], queryFn: organizationsApi.getCurrent });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  React.useEffect(() => {
    if (organization.data) {
      reset({
        name: organization.data.name,
        legalName: organization.data.legalName ?? "",
        businessType: organization.data.businessType ?? undefined,
        industry: organization.data.industry ?? "",
        website: organization.data.website ?? "",
        email: organization.data.email ?? "",
        phone: organization.data.phone ?? "",
        addressLine1: organization.data.addressLine1 ?? "",
        addressLine2: organization.data.addressLine2 ?? "",
        city: organization.data.city ?? "",
        state: organization.data.state ?? "",
        postalCode: organization.data.postalCode ?? "",
        country: organization.data.country ?? "",
        timezone: organization.data.timezone,
        defaultCurrency: organization.data.defaultCurrency,
      });
    }
  }, [organization.data, reset]);

  const update = useMutation({
    mutationFn: organizationsApi.update,
    onSuccess: (updated) => {
      toast.success("Organization updated");
      queryClient.setQueryData(["organization", "current"], updated);
      invalidateSession();
    },
    onError: (error) => toast.error("Could not save changes", toFriendlyErrorMessage(error)),
  });

  const uploadLogo = useMutation({
    mutationFn: organizationsApi.uploadLogo,
    onSuccess: (updated) => {
      toast.success("Logo updated");
      queryClient.setQueryData(["organization", "current"], updated);
      invalidateSession();
    },
    onError: (error) => toast.error("Could not upload logo", toFriendlyErrorMessage(error)),
  });

  const removeLogo = useMutation({
    mutationFn: organizationsApi.removeLogo,
    onSuccess: (updated) => {
      toast.success("Logo removed");
      queryClient.setQueryData(["organization", "current"], updated);
      invalidateSession();
      setRemoveLogoOpen(false);
    },
    onError: (error) => toast.error("Could not remove logo", toFriendlyErrorMessage(error)),
  });

  if (organization.isLoading) return <PageSkeleton />;
  if (organization.isError) {
    return <ErrorState message={toFriendlyErrorMessage(organization.error)} onRetry={() => organization.refetch()} />;
  }
  if (!organization.data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Organization Settings</PageTitle>
        <HelperText className="mt-1">Company identity, contact, address, and branding.</HelperText>
      </div>

      <form onSubmit={handleSubmit((values) => update.mutate(values))} className="flex flex-col gap-6" noValidate>
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="address">Address</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex flex-col gap-4">
            <Input label="Company name" required disabled={!canUpdate} error={errors.name?.message} {...register("name")} />
            <Input label="Legal name" disabled={!canUpdate} error={errors.legalName?.message} {...register("legalName")} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Business type"
                placeholder="Select business type"
                disabled={!canUpdate}
                options={BUSINESS_TYPE_OPTIONS}
                error={errors.businessType?.message}
                {...register("businessType")}
              />
              <Input label="Industry" disabled={!canUpdate} error={errors.industry?.message} {...register("industry")} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Timezone" disabled={!canUpdate} {...register("timezone")} />
              <Input label="Default currency" disabled={!canUpdate} {...register("defaultCurrency")} />
            </div>
          </TabsContent>

          <TabsContent value="contact" className="flex flex-col gap-4">
            <Input label="Business email" type="email" disabled={!canUpdate} error={errors.email?.message} {...register("email")} />
            <Input label="Phone" disabled={!canUpdate} error={errors.phone?.message} {...register("phone")} />
            <Input label="Website" disabled={!canUpdate} error={errors.website?.message} {...register("website")} />
          </TabsContent>

          <TabsContent value="address" className="flex flex-col gap-4">
            <Input label="Address line 1" disabled={!canUpdate} {...register("addressLine1")} />
            <Input label="Address line 2" disabled={!canUpdate} {...register("addressLine2")} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="City" disabled={!canUpdate} {...register("city")} />
              <Input label="State" disabled={!canUpdate} {...register("state")} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Postal code" disabled={!canUpdate} {...register("postalCode")} />
              <Input label="Country" disabled={!canUpdate} {...register("country")} />
            </div>
          </TabsContent>

          <TabsContent value="branding" className="flex flex-col gap-4">
            <SectionTitle>Company logo</SectionTitle>
            <div className="flex items-center gap-4">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {organization.data.logoUrl ? (
                  <Image src={organization.data.logoUrl} alt="Company logo" width={64} height={64} className="size-full object-cover" />
                ) : (
                  <Building2 className="size-6 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              {canUpdate && (
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) uploadLogo.mutate(file);
                      event.target.value = "";
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" loading={uploadLogo.isPending} onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus className="size-4" aria-hidden="true" />
                    {organization.data.logoUrl ? "Replace" : "Upload"}
                  </Button>
                  {organization.data.logoUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveLogoOpen(true)}>
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
            <HelperText>PNG, JPEG, or WEBP. Max 2MB.</HelperText>
          </TabsContent>
        </Tabs>

        {canUpdate && (
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => reset()} disabled={!isDirty}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={removeLogoOpen}
        onOpenChange={setRemoveLogoOpen}
        title="Remove logo"
        description="This will remove your organization's logo."
        confirmLabel="Remove"
        destructive
        loading={removeLogo.isPending}
        onConfirm={() => removeLogo.mutate()}
      />
    </div>
  );
}
