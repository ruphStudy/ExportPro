"use client";

import Link from "next/link";
import { useState } from "react";
import { SUPPLIER_TYPES, type DuplicateCheck } from "@exportpro/types";
import { procurementApi } from "@/lib/api/procurement";
import { ApiRequestError } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { useProcMutation, words } from "@/components/procurement/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";

export function AddSupplier({ open, onOpenChange, defaultProduct, defaultProductId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; defaultProduct?: string; defaultProductId?: string; onCreated: (id: string) => void }) {
  const empty = { legalName: "", supplierType: "", state: "", city: "", contactPerson: "", email: "", phone: "", gstin: "", productName: defaultProduct ?? "", moq: "", moqUnit: "MT", leadTimeDays: "" };
  const [v, setV] = useState(empty);
  const [dups, setDups] = useState<DuplicateCheck["possible"] | null>(null);
  const save = useProcMutation(
    (ack: boolean) =>
      procurementApi.createSupplier({
        legalName: v.legalName.trim(),
        supplierType: v.supplierType || null,
        state: v.state || null,
        city: v.city || null,
        contactPerson: v.contactPerson || null,
        email: v.email || null,
        phone: v.phone || null,
        gstin: v.gstin.trim().toUpperCase() || null,
        acknowledgePossibleDuplicate: ack || undefined,
        products: v.productName ? [{ productName: v.productName, productId: defaultProductId || null, moq: v.moq || null, moqUnit: v.moq ? v.moqUnit : null, leadTimeDays: v.leadTimeDays ? Number(v.leadTimeDays) : null }] : [],
      }),
    "Supplier added",
    (s) => {
      setV(empty);
      setDups(null);
      onOpenChange(false);
      onCreated(s.id);
    },
  );
  const submit = (ack = false) =>
    save.mutate(ack, {
      onError: (e) => {
        if (e instanceof ApiRequestError && (e.details as { code?: string } | undefined)?.code === "POSSIBLE_DUPLICATE_SUPPLIER") setDups(((e.details as { duplicates?: DuplicateCheck["possible"] }).duplicates) ?? []);
        else if (e instanceof ApiRequestError && (e.details as { code?: string } | undefined)?.code === "DUPLICATE_SUPPLIER") toast.error("Supplier already exists", e.message);
      },
    });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add supplier" description="Saved as user-added and unverified. GSTIN format is checked; it is not verified with any registry." className="max-w-lg"
      footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>{dups ? <Button onClick={() => submit(true)} disabled={save.isPending}>Not a duplicate — save</Button> : <Button onClick={() => submit()} disabled={save.isPending || v.legalName.trim().length < 2}>Save supplier</Button>}</div>}>
      <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
        <Input label="Legal name" required containerClassName="sm:col-span-2" value={v.legalName} onChange={set("legalName")} />
        <Select label="Type" value={v.supplierType} onChange={set("supplierType")} options={[{ value: "", label: "Not specified" }, ...SUPPLIER_TYPES.map((t) => ({ value: t, label: words(t) }))]} />
        <Input label="GSTIN" value={v.gstin} onChange={set("gstin")} />
        <Input label="State" value={v.state} onChange={set("state")} />
        <Input label="City" value={v.city} onChange={set("city")} />
        <Input label="Contact person" value={v.contactPerson} onChange={set("contactPerson")} />
        <Input label="Phone" value={v.phone} onChange={set("phone")} />
        <Input label="Email" type="email" containerClassName="sm:col-span-2" value={v.email} onChange={set("email")} />
        <Input label="Product supplied" value={v.productName} onChange={set("productName")} />
        <div className="flex gap-2">
          <Input label="MOQ" inputMode="decimal" containerClassName="flex-1" value={v.moq} onChange={set("moq")} />
          <Select label="Unit" containerClassName="w-24" value={v.moqUnit} onChange={set("moqUnit")} options={["MT", "KG"].map((u) => ({ value: u, label: u }))} />
        </div>
        <Input label="Lead time (days)" inputMode="numeric" value={v.leadTimeDays} onChange={set("leadTimeDays")} />
        {dups && (
          <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm sm:col-span-2">
            Possible duplicate of: {dups.map((d) => <Link key={d.id} className="text-primary hover:underline" href={`/procurement/suppliers/${d.id}`}> {d.legalName} ({d.reason})</Link>)}. Confirm only if this is a different supplier.
          </div>
        )}
      </div>
    </Modal>
  );
}
