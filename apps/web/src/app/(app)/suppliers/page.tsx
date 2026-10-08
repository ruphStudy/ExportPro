import { redirect } from "next/navigation";

/** Sprint 21: supplier management lives under Procurement. */
export default function Page() {
  redirect("/procurement/suppliers");
}
