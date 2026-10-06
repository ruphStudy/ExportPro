import {
  BarChart3,
  Calculator,
  ClipboardCheck,
  Contact,
  FileText,
  Globe2,
  Inbox,
  LayoutDashboard,
  Map as MapIcon,
  Package,
  Settings,
  Sparkles,
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
    label: "Export Setup",
    href: "/export-setup",
    icon: ClipboardCheck,
    status: "active",
    permission: "onboarding.view",
    description: "Exporter profile, products, markets, registrations, and readiness.",
  },
  {
    label: "Opportunities",
    href: "/opportunities",
    icon: Globe2,
    status: "active",
    permission: "opportunities.view",
    description: "Discover export opportunities by product and country.",
  },
  {
    label: "Products",
    href: "/products",
    icon: Package,
    status: "active",
    permission: "products.view",
    description: "Analyze products and manage HS / ITC-HS classifications.",
  },
  {
    label: "Markets",
    href: "/markets",
    icon: MapIcon,
    status: "active",
    permission: "country_intelligence.view",
    description: "Country market intelligence: best markets and products by country.",
  },
  {
    label: "Recommendations",
    href: "/recommendations",
    icon: Sparkles,
    status: "active",
    permission: "recommendations.view",
    description: "Personalized product × market recommendations and comparisons.",
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

/** Routes without their own sidebar item, shown under the closest parent section. */
const SECTION_ALIASES: Record<string, string> = { "/compare": "/recommendations" };

export function findNavItemByPath(pathname: string): NavItem | undefined {
  const alias = Object.entries(SECTION_ALIASES).find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const path = alias ? alias[1] : pathname;
  return NAV_ITEMS.find((item) => path === item.href || path.startsWith(`${item.href}/`));
}
