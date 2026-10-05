import {
  BarChart3,
  Calculator,
  Contact,
  FileText,
  Globe2,
  Inbox,
  LayoutDashboard,
  Package,
  Settings,
  Ship,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * "active" renders the item's real page. "placeholder" still renders
   * a page (via <PlaceholderPage>), but is clearly marked as upcoming —
   * never a dead link, and never a fake implemented feature either.
   */
  status: "active" | "placeholder";
  /** Required permission string — see lib/permissions.ts. No-op until Sprint 2's RBAC lands. */
  permission?: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    status: "active",
    description: "Foundation overview of your workspace.",
  },
  {
    label: "Opportunities",
    href: "/opportunities",
    icon: Globe2,
    status: "placeholder",
    description: "Discover export/import opportunities by product and country.",
  },
  {
    label: "Products",
    href: "/products",
    icon: Package,
    status: "placeholder",
    description: "Manage your product catalog and HS classifications.",
  },
  {
    label: "Buyers & Suppliers",
    href: "/buyers",
    icon: Users,
    status: "placeholder",
    description: "Find and manage buyers and suppliers.",
  },
  {
    label: "CRM",
    href: "/crm",
    icon: Contact,
    status: "placeholder",
    description: "Track relationships and outreach.",
  },
  {
    label: "Inquiries & RFQs",
    href: "/inquiries",
    icon: Inbox,
    status: "placeholder",
    description: "Manage inbound and outbound inquiries.",
  },
  {
    label: "Costing & Quotations",
    href: "/costing",
    icon: Calculator,
    status: "placeholder",
    description: "Build costing sheets, quotations, and proforma invoices.",
  },
  {
    label: "Documents & Compliance",
    href: "/documents",
    icon: FileText,
    status: "placeholder",
    description: "Trade documents and compliance tracking.",
  },
  {
    label: "Shipments & Logistics",
    href: "/shipments",
    icon: Ship,
    status: "placeholder",
    description: "Track shipments and logistics milestones.",
  },
  {
    label: "Suppliers & Procurement",
    href: "/suppliers",
    icon: Truck,
    status: "placeholder",
    description: "Manage procurement and supplier sourcing.",
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    status: "placeholder",
    description: "Profitability and trade analytics.",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    status: "placeholder",
    description: "Organization, team, and account settings.",
  },
];

export function findNavItemByPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
