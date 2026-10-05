import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/shipments")!;

export default function Page() {
  return <PlaceholderPage title={item.label} description={item.description} icon={item.icon} />;
}
