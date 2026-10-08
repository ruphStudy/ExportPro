import { z } from 'zod';
import type { AiActionKind, AiActionName } from '@exportpro/types';
import type { Perm } from '../finance/finance-core.service';

/**
 * AiManagerActionRegistry — the only actions the AI Export Manager can run.
 * Each entry declares its permission, input schema and read/write class; handlers
 * live in AiManagerService and call existing domain services.
 */
export interface AiActionDefinition {
  name: AiActionName;
  label: string;
  description: string;
  kind: AiActionKind;
  /** Meaningful writes (commercial, financial, CRM) always need explicit confirmation. */
  confirmationRequired: boolean;
  permission: Perm;
  input: z.ZodTypeAny;
  output: string;
}

const str = z.string().min(1).max(160);
const opt = str.nullable().optional();

export const AI_ACTIONS: Record<AiActionName, AiActionDefinition> = {
  navigate: {
    name: 'navigate',
    label: 'Open a module',
    description:
      'Open a page/module (crm, buyers, quotations, shipments, receivables, analytics…).',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'ai_manager.use',
    input: z.object({ module: opt }),
    output: 'links',
  },
  analyze_product_market: {
    name: 'analyze_product_market',
    label: 'Analyze product for a market',
    description:
      'Product-country market intelligence (score, demand, competition, tariff) for a product in a country.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'country_intelligence.view',
    input: z.object({ product: str, country: str }),
    output: 'market analysis with source/freshness',
  },
  product_markets: {
    name: 'product_markets',
    label: 'Best markets for a product',
    description: 'Ranked destination markets for a product.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'country_intelligence.view',
    input: z.object({ product: str }),
    output: 'market ranking',
  },
  discover_opportunities: {
    name: 'discover_opportunities',
    label: 'Discover opportunities',
    description:
      'Search export opportunities, optionally under an investment budget (e.g. under ₹5 lakh).',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'opportunities.view',
    input: z.object({ maxInvestment: opt, product: opt }),
    output: 'opportunity list',
  },
  find_buyers: {
    name: 'find_buyers',
    label: 'Find buyers',
    description: 'Buyer discovery for a product and/or country.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'buyers.view',
    input: z.object({ product: opt, country: opt }),
    output: 'buyers with match, risk, contact confidence, source',
  },
  create_crm_lead: {
    name: 'create_crm_lead',
    label: 'Add buyer to CRM',
    description: 'Create a CRM lead for a discovered buyer.',
    kind: 'WRITE',
    confirmationRequired: true,
    permission: 'buyers.crm_handoff',
    input: z.object({ buyer: str, product: opt, country: opt }),
    output: 'CRM lead link',
  },
  inspect_inquiry: {
    name: 'inspect_inquiry',
    label: 'Summarize RFQ',
    description: 'Summarize an inquiry/RFQ and its confirmation status.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'inquiries.view',
    input: z.object({ inquiry: opt }),
    output: 'RFQ summary',
  },
  prepare_quotation: {
    name: 'prepare_quotation',
    label: 'Prepare quotation from RFQ',
    description:
      'Check an RFQ for missing data and propose creating a draft quotation.',
    kind: 'WRITE',
    confirmationRequired: true,
    permission: 'quotations.create',
    input: z.object({ inquiry: opt }),
    output: 'draft quotation link',
  },
  missing_documents: {
    name: 'missing_documents',
    label: 'Missing shipment documents',
    description:
      'Documents missing now / expected later / awaiting validation for accepted orders.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'document_validation.view',
    input: z.object({ shipment: opt }),
    output: 'document status',
  },
  shipment_status: {
    name: 'shipment_status',
    label: 'Shipment status',
    description:
      'Active, delayed and in-transit shipments, or one shipment by number.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'logistics.view',
    input: z.object({ shipment: opt }),
    output: 'shipment summary',
  },
  shipment_exceptions: {
    name: 'shipment_exceptions',
    label: 'Shipment exceptions',
    description: 'Open shipment exceptions.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'logistics.view',
    input: z.object({ shipment: opt }),
    output: 'exceptions',
  },
  overdue_receivables: {
    name: 'overdue_receivables',
    label: 'Overdue payments',
    description: 'Overdue and outstanding receivables.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'finance.view',
    input: z.object({ receivable: opt }),
    output: 'receivables',
  },
  record_payment: {
    name: 'record_payment',
    label: 'Record payment received',
    description:
      'Record a payment the user states was received (amount, currency and receivable must be given).',
    kind: 'WRITE',
    confirmationRequired: true,
    permission: 'payments.record',
    input: z.object({
      receivable: str,
      amount: str,
      currency: str,
      reference: opt,
    }),
    output: 'updated receivable',
  },
  draft_payment_reminder: {
    name: 'draft_payment_reminder',
    label: 'Draft payment reminder',
    description: 'Create a payment reminder DRAFT (never sent).',
    kind: 'WRITE',
    confirmationRequired: false,
    permission: 'receivables.manage',
    input: z.object({ receivable: str }),
    output: 'reminder draft link',
  },
  profitability_summary: {
    name: 'profitability_summary',
    label: 'Profitability summary',
    description: 'Finalized shipment/buyer profitability.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'profitability.view',
    input: z.object({}),
    output: 'profit summary',
  },
  reorder_followups: {
    name: 'reorder_followups',
    label: 'Reorder follow-ups',
    description: 'Buyers due for reorder based on their order cadence.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'repeat_business.view',
    input: z.object({}),
    output: 'buyers due',
  },
  follow_ups_today: {
    name: 'follow_ups_today',
    label: 'Who to follow up today',
    description:
      'Prioritized follow-ups: CRM tasks, no-reply outreach, overdue payments, reorder windows, shipment exceptions.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'action_center.view',
    input: z.object({}),
    output: 'prioritized list',
  },
  needs_attention: {
    name: 'needs_attention',
    label: 'What needs attention',
    description: 'Top Action Center items.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'action_center.view',
    input: z.object({}),
    output: 'action items',
  },
  analytics_summary: {
    name: 'analytics_summary',
    label: 'Business summary',
    description: 'Executive KPIs and computed insights for this month.',
    kind: 'READ',
    confirmationRequired: false,
    permission: 'analytics.view',
    input: z.object({}),
    output: 'KPIs and insights',
  },
};

export const QUICK_COMMANDS = [
  { label: 'Analyze product', command: 'Analyze cumin for UAE' },
  { label: 'Find buyers', command: 'Find buyers for cumin in UAE' },
  { label: 'View follow-ups', command: 'Who should I follow up today?' },
  {
    label: 'Check missing documents',
    command: 'Which shipment documents are missing?',
  },
  { label: 'Check delayed shipments', command: 'Show delayed shipments' },
  { label: 'Check overdue payments', command: 'Show overdue payments' },
  { label: 'Show profitability', command: 'Show profitability' },
  { label: 'What needs attention?', command: 'What needs my attention?' },
];

export const MODULE_LINKS: Record<
  string,
  { label: string; href: string; perm: Perm }
> = {
  crm: { label: 'CRM', href: '/crm', perm: 'crm.view' },
  buyers: { label: 'Buyer discovery', href: '/buyers', perm: 'buyers.view' },
  opportunities: {
    label: 'Opportunities',
    href: '/opportunities',
    perm: 'opportunities.view',
  },
  inquiries: {
    label: 'Inquiries / RFQs',
    href: '/inquiries',
    perm: 'inquiries.view',
  },
  rfq: {
    label: 'Inquiries / RFQs',
    href: '/inquiries',
    perm: 'inquiries.view',
  },
  quotations: {
    label: 'Quotations',
    href: '/quotations',
    perm: 'quotations.view',
  },
  costing: { label: 'Costing', href: '/costing', perm: 'costing.view' },
  compliance: {
    label: 'Compliance',
    href: '/compliance',
    perm: 'compliance.view',
  },
  documents: { label: 'Documents', href: '/documents', perm: 'documents.view' },
  shipments: { label: 'Shipments', href: '/shipments', perm: 'logistics.view' },
  freight: {
    label: 'Freight quotes',
    href: '/freight-quotes',
    perm: 'logistics.view',
  },
  receivables: {
    label: 'Receivables',
    href: '/finance/receivables',
    perm: 'finance.view',
  },
  finance: { label: 'Finance', href: '/finance', perm: 'finance.view' },
  profitability: {
    label: 'Profitability',
    href: '/profitability',
    perm: 'profitability.view',
  },
  repeat: {
    label: 'Repeat business',
    href: '/repeat-business',
    perm: 'repeat_business.view',
  },
  outreach: { label: 'Outreach', href: '/outreach', perm: 'outreach.view' },
  products: { label: 'Products', href: '/products', perm: 'products.view' },
  action: {
    label: 'Action Center',
    href: '/action-center',
    perm: 'action_center.view',
  },
  automation: {
    label: 'Automation',
    href: '/automation',
    perm: 'automation.view',
  },
  analytics: { label: 'Analytics', href: '/analytics', perm: 'analytics.view' },
};
