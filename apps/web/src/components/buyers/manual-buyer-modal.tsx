"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { BuyerType } from "@exportpro/types";
import { COUNTRIES } from "@exportpro/types";
import { buyersApi } from "@/lib/api/buyers";
import { ApiRequestError, toFriendlyErrorMessage } from "@/lib/api-client";
import { BUYER_TYPE_LABELS } from "@/lib/buyer-labels";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HelperText } from "@/components/ui/typography";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the company name.").max(160),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "Select a country."),
  city: z.string().max(80).optional(),
  website: z.string().max(200).optional(),
  buyerType: z.string().optional(),
  hsCode: z.string().regex(/^(\d{2}|\d{4}|\d{6}|\d{8})?$/, "HS code must be 2, 4, 6 or 8 digits.").optional(),
  productName: z.string().max(120).optional(),
  contactName: z.string().max(120).optional(),
  contactRole: z.string().max(120).optional(),
  contactEmail: z.union([z.literal(""), z.string().email("Enter a valid email address.")]).optional(),
  contactPhone: z.union([z.literal(""), z.string().regex(/^\+[1-9][\d\s().-]{7,20}$/, "Use international format, e.g. +971 4 123 4567.")]).optional(),
  notes: z.string().max(5000).optional(),
});
type Values = z.infer<typeof schema>;

/** Organization-private, USER_PROVIDED buyer. Never shown to other organizations and never treated as verified. */
export function ManualBuyerModal({ open, onOpenChange, defaultCountry }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCountry?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { countryCode: defaultCountry ?? "" } });
  const m = useMutation({
    mutationFn: (v: Values) => {
      const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined)) as Values;
      return buyersApi.create({ ...clean, buyerType: clean.buyerType as BuyerType | undefined });
    },
    onSuccess: (r) => {
      toast.success("Buyer added", "Visible only to your organization.");
      qc.invalidateQueries({ queryKey: ["buyers"] });
      reset();
      onOpenChange(false);
      router.push(`/buyers/${r.id}`);
    },
    onError: (e) => {
      const existing = e instanceof ApiRequestError && e.status === 409 ? (e.details as { existingBuyerId?: string } | undefined)?.existingBuyerId : undefined;
      if (existing) {
        toast.info("This buyer already exists", "Opening the existing record instead of creating a duplicate.");
        onOpenChange(false);
        router.push(`/buyers/${existing}`);
      } else toast.error("Could not add buyer", toFriendlyErrorMessage(e));
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add a buyer you found"
      description="Recorded as user-provided and private to your organization. It is not treated as verified."
      className="max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto"
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => m.mutate(v))} noValidate>
        <Input label="Company name" required containerClassName="sm:col-span-2" error={errors.name?.message} {...register("name")} />
        <Select label="Country" required placeholder="Select country" error={errors.countryCode?.message} options={COUNTRIES.map((c) => ({ value: c.code, label: c.label }))} {...register("countryCode")} />
        <Input label="City" {...register("city")} />
        <Input label="Website" placeholder="company.com" error={errors.website?.message} {...register("website")} />
        <Select label="Buyer type" placeholder="Unknown" options={(["IMPORTER", "DISTRIBUTOR", "WHOLESALER", "RETAILER", "MANUFACTURER", "AGENT", "OTHER"] as const).map((t) => ({ value: t, label: BUYER_TYPE_LABELS[t] }))} {...register("buyerType")} />
        <Input label="HS code" inputMode="numeric" error={errors.hsCode?.message} {...register("hsCode")} />
        <Input label="Product" {...register("productName")} />
        <Input label="Contact name" {...register("contactName")} />
        <Input label="Contact role" {...register("contactRole")} />
        <Input label="Business email" type="email" error={errors.contactEmail?.message} {...register("contactEmail")} />
        <Input label="Business phone" type="tel" error={errors.contactPhone?.message} {...register("contactPhone")} />
        <Textarea label="Private note" containerClassName="sm:col-span-2" rows={3} {...register("notes")} />
        <HelperText className="sm:col-span-2">Only add business contact details you obtained legitimately. The website is checked for valid syntax only — it is not visited.</HelperText>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={m.isPending}>{m.isPending ? "Adding…" : "Add buyer"}</Button>
        </div>
      </form>
    </Modal>
  );
}
