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
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@exportpro/types";

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
  /** Required permission — see lib/permissions.ts. Omit for pages every authenticated member can see (e.g. their own profile/security). */
  permission?: Permission;
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
    label: "Team",
    href: "/team",
    icon: Users,
    status: "active",
    permission: "team.view",
    description: "Manage organization members, roles, and invitations.",
  },
  {
    label: "Organization Settings",
    href: "/settings",
    icon: Settings,
    status: "active",
    permission: "organization.view",
    description: "Company identity, contact, address, and branding.",
  },
  {
    label: "Profile",
    href: "/profile",
    icon: UserRound,
    status: "active",
    description: "Your personal account details.",
  },
  {
    label: "Security",
    href: "/security",
    icon: ShieldCheck,
    status: "active",
    description: "Password, active sessions, and devices.",
  },
];

export function findNavItemByPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
