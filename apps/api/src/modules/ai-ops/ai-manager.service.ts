import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  AI_ACTION_NAMES,
  countryLabel,
  roleHasPermission,
  type AiActionDefinitionView,
  type AiActionName,
  type AiActionPreview,
  type AiConfirmResult,
  type AiExecutionView,
  type AiIntent,
  type AiResponse,
  type InvestmentRange,
  type Permission,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BuyersService } from '../buyers/buyers.service';
import type { Actor } from '../commercial/commercial-core.service';
import { QuotationsService } from '../commercial/quotations.service';
import { CountryIntelligenceService } from '../country-intelligence/country-intelligence.service';
import { DocumentValidationService } from '../document-validation/validation.service';
import { AnalyticsService as FinanceAnalyticsService } from '../finance/analytics.service';
import { ReceivablesService } from '../finance/receivables.service';
import { InquiriesService } from '../inquiries/inquiries.service';
import { ShipmentsService } from '../logistics/shipments.service';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { ProductsService } from '../products/products.service';
import { ActionCenterService } from './action-center.service';
import { AI_ACTIONS, MODULE_LINKS, QUICK_COMMANDS } from './action-registry';
import {
  AI_MANAGER_PROVIDER,
  AiManagerProviderError,
  type AiManagerProvider,
} from './ai-manager.provider';
import { AutomationService } from './automation.service';
import { ExecutiveAnalyticsService } from './executive-analytics.service';
import { parseCommand, resolveCountry, validateIntent } from './ops-rules';

type Ctx = Record<string, string | null>;
type Part = Partial<
  Omit<
    AiResponse,
    | 'conversationId'
    | 'messageId'
    | 'interpretedBy'
    | 'providerAvailable'
    | 'intent'
    | 'context'
  >
> & { text: string; ctx?: Ctx };

class Clarify {
  constructor(
    readonly question: string,
    readonly options: { label: string; command: string }[],
  ) {}
}

const today = () => new Date().toISOString().slice(0, 10);
const INVESTMENT: [number, InvestmentRange][] = [
  [100000, 'UNDER_1L'],
  [500000, 'L1_5'],
  [1000000, 'L5_10'],
  [2500000, 'L10_25'],
  [5000000, 'L25_50'],
  [10000000, 'L50_1CR'],
];

/**
 * AI Export Manager: interpret → resolve entities → check RBAC → read via existing
 * services, or propose a write that only runs after explicit confirmation.
 * The AI classifies intent only; every figure comes from a module service.
 */
@Injectable()
export class AiManagerService {
  private readonly logger = new Logger(AiManagerService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_MANAGER_PROVIDER) private readonly provider: AiManagerProvider,
    private readonly products: ProductsService,
    private readonly countries: CountryIntelligenceService,
    private readonly opportunities: OpportunitiesService,
    private readonly buyers: BuyersService,
    private readonly inquiries: InquiriesService,
    private readonly quotations: QuotationsService,
    private readonly validation: DocumentValidationService,
    private readonly shipments: ShipmentsService,
    private readonly receivables: ReceivablesService,
    private readonly financeAnalytics: FinanceAnalyticsService,
    private readonly actions: ActionCenterService,
    private readonly automation: AutomationService,
    private readonly analytics: ExecutiveAnalyticsService,
    private readonly audit: AuditService,
  ) {}

  private can(a: Actor, p: Permission) {
    return roleHasPermission(a.role, p);
  }

  catalog(a: Actor): {
    actions: AiActionDefinitionView[];
    quickCommands: typeof QUICK_COMMANDS;
    provider: { name: string; available: boolean };
  } {
    return {
      actions: AI_ACTION_NAMES.map((n) => {
        const d = AI_ACTIONS[n];
        return {
          name: n,
          label: d.label,
          description: d.description,
          kind: d.kind,
          confirmationRequired: d.confirmationRequired,
          permission: d.permission,
          allowed:
            this.can(a, d.permission) &&
            (d.kind === 'READ' || this.can(a, 'ai_manager.execute')),
        };
      }),
      quickCommands: QUICK_COMMANDS.filter((c) => {
        const i = parseCommand(c.command);
        return !i.action || this.can(a, AI_ACTIONS[i.action].permission);
      }),
      provider: {
        name: this.provider.name,
        available: this.provider.available,
      },
    };
  }

  // ---------------------------------------------------------------- conversation

  private async conversation(a: Actor, id?: string) {
    if (id) {
      const c = await this.prisma.aiConversation.findFirst({
        where: { id, organizationId: a.organizationId, userId: a.userId },
      });
      if (!c) throw new NotFoundException('Conversation not found.');
      return c;
    }
    return this.prisma.aiConversation.create({
      data: { organizationId: a.organizationId, userId: a.userId },
    });
  }

  async history(a: Actor, conversationId?: string) {
    const c = conversationId
      ? await this.prisma.aiConversation.findFirst({
          where: {
            id: conversationId,
            organizationId: a.organizationId,
            userId: a.userId,
          },
        })
      : await this.prisma.aiConversation.findFirst({
          where: { organizationId: a.organizationId, userId: a.userId },
          orderBy: { updatedAt: 'desc' },
        });
    if (!c) return { conversationId: null, messages: [], context: {} };
    const msgs = await this.prisma.aiMessage.findMany({
      where: { conversationId: c.id },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return {
      conversationId: c.id,
      context: c.context,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        text: m.text,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async message(
    a: Actor,
    dto: { message?: string; command?: string; conversationId?: string },
  ): Promise<AiResponse> {
    const text = (dto.command ?? dto.message ?? '').trim().slice(0, 2000);
    const conv = await this.conversation(a, dto.conversationId);
    const ctx = (conv.context ?? {}) as Ctx;
    await this.prisma.aiMessage.create({
      data: {
        organizationId: a.organizationId,
        conversationId: conv.id,
        role: 'user',
        text: text.slice(0, 1000),
      },
    });
    let interpretedBy: AiResponse['interpretedBy'] = dto.command
      ? 'command'
      : this.provider.name === 'anthropic'
        ? 'ai'
        : 'rules';
    let providerAvailable = this.provider.available;
    let intent: AiIntent | null = null;
    let notice: string | null = null;
    if (dto.command || this.provider.name !== 'anthropic') {
      intent = parseCommand(text, ctx);
      if (!this.provider.available && !dto.command)
        notice =
          'AI interpretation is unavailable — matched your text against predefined commands.';
    } else {
      try {
        intent = validateIntent(
          await this.provider.parse({
            message: text,
            context: ctx,
            actions: AI_NAMES_FOR_PROMPT,
          }),
        );
        if (!intent) {
          notice =
            'The AI response could not be validated — using predefined commands instead.';
          intent = parseCommand(text, ctx);
          interpretedBy = 'rules';
        }
      } catch (e) {
        providerAvailable = false;
        interpretedBy = 'rules';
        notice =
          e instanceof AiManagerProviderError
            ? `${e.message} Using predefined commands.`
            : 'AI provider unavailable. Using predefined commands.';
        intent = parseCommand(text, ctx);
      }
    }
    let part: Part;
    try {
      part = await this.handle(a, intent, ctx, conv.id);
    } catch (e) {
      if (e instanceof Clarify)
        part = {
          text: e.question,
          clarification: { question: e.question, options: e.options },
        };
      else if (
        e instanceof ForbiddenException ||
        e instanceof NotFoundException ||
        e instanceof ConflictException
      )
        part = { text: e.message };
      else {
        this.logger.warn(`AI Manager action failed: ${(e as Error).message}`);
        part = {
          text: `That request could not be completed: ${(e as Error).message}`,
        };
      }
    }
    if (notice) part.text = `${notice}\n\n${part.text}`;
    const newCtx = { ...ctx, ...(part.ctx ?? {}) };
    await this.prisma.aiConversation.update({
      where: { id: conv.id },
      data: { context: newCtx as Prisma.InputJsonValue },
    });
    const msg = await this.prisma.aiMessage.create({
      data: {
        organizationId: a.organizationId,
        conversationId: conv.id,
        role: 'assistant',
        text: part.text.slice(0, 1000),
        intent: intent
          ? ({
              intent: intent.intent,
              action: intent.action,
            } as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return {
      conversationId: conv.id,
      messageId: msg.id,
      interpretedBy,
      providerAvailable,
      intent,
      text: part.text,
      bullets: part.bullets ?? [],
      table: part.table ?? null,
      provenance: part.provenance ?? [],
      links: part.links ?? [],
      suggestions:
        part.suggestions ?? (intent?.action ? [] : QUICK_COMMANDS.slice(0, 6)),
      clarification: part.clarification ?? null,
      preview: part.preview ?? null,
      denied: part.denied ?? null,
      context: newCtx,
    };
  }

  // ---------------------------------------------------------------- routing

  private async handle(
    a: Actor,
    intent: AiIntent | null,
    ctx: Ctx,
    conversationId: string,
  ): Promise<Part> {
    if (!intent?.action || intent.confidence < 30)
      return {
        text: 'I could not match that to something I can do. Try one of these, or rephrase (e.g. “Analyze cumin for UAE”).',
        suggestions: QUICK_COMMANDS,
      };
    const def = AI_ACTIONS[intent.action];
    // RBAC: the AI can never do more than the user's role allows.
    const missing: Permission | null = !this.can(a, def.permission)
      ? def.permission
      : def.kind === 'WRITE' && !this.can(a, 'ai_manager.execute')
        ? 'ai_manager.execute'
        : null;
    if (missing)
      return {
        text: `“${def.label}” is not available for your role. It needs the ${missing} permission — ask an owner or admin.`,
        denied: {
          action: def.label,
          permission: missing,
          reason: 'Your role does not allow this action; nothing was changed.',
        },
      };
    const e = intent.entities;
    switch (intent.action) {
      case 'navigate':
        return this.navigate(a, e.module ?? '');
      case 'analyze_product_market':
        return this.analyze(
          a,
          e.product ?? ctx.product,
          e.country ?? ctx.country,
        );
      case 'product_markets':
        return this.markets(a, e.product ?? ctx.product);
      case 'discover_opportunities':
        return this.discover(a, e.maxInvestment ?? null, e.product ?? null);
      case 'find_buyers':
        return this.findBuyers(
          a,
          e.product ?? ctx.product,
          e.country ?? ctx.country,
        );
      case 'create_crm_lead':
        return this.proposeLead(
          a,
          conversationId,
          e.buyer ?? ctx.buyer,
          e.product ?? ctx.product,
          e.country ?? ctx.country,
        );
      case 'inspect_inquiry':
        return this.inspectInquiry(a, e.inquiry ?? ctx.inquiry);
      case 'prepare_quotation':
        return this.proposeQuotation(
          a,
          conversationId,
          e.inquiry ?? ctx.inquiry,
        );
      case 'missing_documents':
        return this.missingDocs(a, e.shipment ?? null);
      case 'shipment_status':
        return this.shipmentStatus(
          a,
          e.shipment ?? null,
          intent.intent === 'delayed_shipments',
        );
      case 'shipment_exceptions':
        return this.exceptions(a);
      case 'overdue_receivables':
        return this.overdue(a);
      case 'record_payment':
        return this.proposePayment(a, conversationId, e);
      case 'draft_payment_reminder':
        return this.draftReminder(
          a,
          conversationId,
          e.receivable ?? ctx.receivable,
        );
      case 'profitability_summary':
        return this.profit(a);
      case 'reorder_followups':
        return this.reorder(a);
      case 'follow_ups_today':
        return this.attention(
          a,
          [
            'CRM_TASK_OVERDUE',
            'NO_BUYER_RESPONSE',
            'PAYMENT_OVERDUE',
            'REORDER_WINDOW',
            'SHIPMENT_EXCEPTION',
            'ETA_CHANGE',
            'QUOTATION_EXPIRY',
          ],
          'Follow-ups for today, highest priority first:',
        );
      case 'needs_attention':
        return this.attention(a, null, 'Needs your attention:');
      case 'analytics_summary':
        return this.summary(a);
    }
  }

  // ---------------------------------------------------------------- resolution

  /** Exact or unique match only — several candidates always produce a clarification. */
  private async product(
    a: Actor,
    name: string | null | undefined,
    cmd: (p: string) => string,
  ) {
    if (!name)
      throw new Clarify(
        'Which product? Name one from your product catalogue.',
        [],
      );
    const r = await this.products.list(a.organizationId, name, 1, 10);
    const exact = r.items.filter(
      (p) => p.displayName.toLowerCase() === name.toLowerCase(),
    );
    if (exact.length === 1) return exact[0];
    if (r.items.length === 1) return r.items[0];
    if (!r.items.length)
      throw new Clarify(
        `No product matching “${name}” is in your catalogue. Add it under Products first.`,
        [{ label: 'Open products', command: 'Open products' }],
      );
    throw new Clarify(
      `Several products match “${name}”. Which one?`,
      r.items
        .slice(0, 6)
        .map((p) => ({ label: p.displayName, command: cmd(p.displayName) })),
    );
  }

  private country(raw: string | null | undefined, required: boolean) {
    if (!raw) {
      if (required)
        throw new Clarify('Which country? e.g. UAE, Germany, US.', []);
      return null;
    }
    const cc = resolveCountry(raw);
    if (!cc)
      throw new Clarify(
        `I don’t recognise the country “${raw}”. Use its name or ISO code (e.g. AE).`,
        [],
      );
    return cc;
  }

  // ---------------------------------------------------------------- read handlers

  private navigate(a: Actor, module: string): Part {
    const k = Object.keys(MODULE_LINKS).find((x) =>
      module.toLowerCase().includes(x),
    );
    const links = k ? [MODULE_LINKS[k]] : Object.values(MODULE_LINKS);
    const ok = links.filter((l) => this.can(a, l.perm));
    return {
      text: k
        ? ok.length
          ? `Opening ${ok[0].label}.`
          : `You don't have access to ${links[0].label}.`
        : 'Where would you like to go?',
      links: ok.slice(0, 12).map((l) => ({ label: l.label, href: l.href })),
    };
  }

  private async analyze(
    a: Actor,
    productName: string | null | undefined,
    countryRaw: string | null | undefined,
  ): Promise<Part> {
    const cc = this.country(countryRaw, true)!;
    const p = await this.product(
      a,
      productName,
      (n) => `Analyze ${n} for ${countryLabel(cc)}`,
    );
    const r = await this.countries.deepAnalysis(
      a.organizationId,
      a.userId,
      p.id,
      cc,
    );
    const ctx = { product: p.displayName, productId: p.id, country: cc };
    if (r.status !== 'AVAILABLE')
      return {
        text: `${p.displayName} → ${countryLabel(cc)}: ${(r as { message: string }).message}`,
        ctx,
        links: [{ label: 'Market intelligence', href: `/products/${p.id}` }],
      };
    const d = r;
    return {
      text: `${p.displayName} → ${d.country.name}: opportunity score ${d.opportunityScore}/100 (confidence ${d.confidence}%).`,
      bullets: [
        d.marketSize.available && d.marketSize.importValue !== null
          ? `Imports: ${d.marketSize.currency} ${d.marketSize.importValue.toLocaleString('en-IN')} (${d.marketSize.period})`
          : 'Import value: not available in the dataset',
        `India share: ${d.indiaPosition.sharePercent}%${d.indiaPosition.rank ? ` (rank ${d.indiaPosition.rank})` : ''}`,
        `Competition: ${d.competition.level.toLowerCase()} — ${d.competition.explanation}`,
        ...d.reasons.slice(0, 3),
        ...d.risks.slice(0, 2).map((x) => `Risk: ${x}`),
      ],
      provenance: [
        {
          module: 'Country intelligence',
          source: `${d.source.sourceName}${d.source.isSample ? ' (sample data — not official statistics)' : ''}`,
          freshness: d.source.freshness,
          asOf: d.source.lastUpdatedAt,
          confidence: d.confidence,
        },
      ],
      links: [
        {
          label: 'Full market analysis',
          href: `/products/${p.id}/markets/${cc}`,
        },
      ],
      suggestions: [
        {
          label: 'Find buyers',
          command: `Find buyers for ${p.displayName} in ${d.country.name}`,
        },
        { label: 'Best markets', command: `Markets for ${p.displayName}` },
        ...(this.can(a, 'costing.view')
          ? [{ label: 'Run costing', command: 'Open costing' }]
          : []),
      ],
      ctx,
    };
  }

  private async markets(
    a: Actor,
    productName: string | null | undefined,
  ): Promise<Part> {
    const p = await this.product(a, productName, (n) => `Markets for ${n}`);
    const r = await this.countries.productMarkets(a.organizationId, p.id, {
      page: 1,
      pageSize: 5,
    });
    if (r.status !== 'AVAILABLE' || !r.items.length)
      return {
        text: r.message ?? `No market data available for ${p.displayName}.`,
        ctx: { product: p.displayName, productId: p.id },
      };
    return {
      text: `Top markets for ${p.displayName}:`,
      table: {
        columns: ['#', 'Country', 'Score', 'Confidence', 'Entry'],
        rows: r.items.map((m) => [
          String(m.rank),
          m.country.name,
          String(m.opportunityScore),
          `${m.confidence}%`,
          String(m.marketEntry).toLowerCase(),
        ]),
      },
      provenance: r.source
        ? [
            {
              module: 'Country intelligence',
              source: `${r.source.sourceName}${r.source.isSample ? ' (sample data)' : ''}`,
              freshness: r.source.freshness,
              asOf: r.source.lastUpdatedAt,
              confidence: null,
            },
          ]
        : [],
      suggestions: r.items.slice(0, 2).map((m) => ({
        label: `Analyze ${m.country.name}`,
        command: `Analyze ${p.displayName} for ${m.country.name}`,
      })),
      ctx: { product: p.displayName, productId: p.id },
    };
  }

  private async discover(
    a: Actor,
    maxInvestment: string | null,
    product: string | null,
  ): Promise<Part> {
    let budget: InvestmentRange | undefined;
    if (maxInvestment) {
      const m = /([\d.]+)\s*(lakh|lac|l|crore|cr)/i.exec(maxInvestment);
      const inr = m
        ? Number(m[1]) * (/^c/i.test(m[2]) ? 10000000 : 100000)
        : null;
      budget = inr
        ? (INVESTMENT.find(([lim]) => inr <= lim)?.[1] ?? 'ABOVE_1CR')
        : undefined;
    }
    const r = await this.opportunities.search(a.organizationId, {
      budget,
      search: product ?? undefined,
      page: 1,
      pageSize: 8,
      sort: 'score',
    } as never);
    if (!r.items.length)
      return { text: 'No opportunities match those criteria.' };
    return {
      text: `${r.meta.totalItems} opportunit${r.meta.totalItems === 1 ? 'y' : 'ies'}${budget ? ` within your investment range (${maxInvestment})` : ''}; top results:`,
      table: {
        columns: ['Product', 'Market', 'Score', 'Investment', 'Freshness'],
        rows: r.items.map((o) => [
          o.productName,
          countryLabel(o.destinationCountryCode),
          String(o.overallScore),
          o.investmentRange.replace(/_/g, ' '),
          o.source.freshness.toLowerCase(),
        ]),
      },
      provenance: [
        {
          module: 'Opportunities',
          source: r.items[0].source.sourceName,
          freshness: r.items[0].source.freshness,
          asOf: r.items[0].source.lastUpdatedAt,
          confidence: r.items[0].confidenceScore,
        },
      ],
      links: [{ label: 'Open opportunities', href: '/opportunities' }],
    };
  }

  private async findBuyers(
    a: Actor,
    productName: string | null | undefined,
    countryRaw: string | null | undefined,
  ): Promise<Part> {
    const cc = this.country(countryRaw, false);
    const p = productName
      ? await this.product(
          a,
          productName,
          (n) => `Find buyers for ${n}${cc ? ` in ${countryLabel(cc)}` : ''}`,
        )
      : null;
    const r = await this.buyers.search(a.organizationId, {
      productId: p?.id,
      country: cc ?? undefined,
      page: 1,
      pageSize: 8,
    } as never);
    const ctx = {
      ...(p ? { product: p.displayName, productId: p.id } : {}),
      ...(cc ? { country: cc } : {}),
    };
    if (!r.items.length)
      return {
        text: `No buyers found${p ? ` for ${p.displayName}` : ''}${cc ? ` in ${countryLabel(cc)}` : ''}. Buyers are never invented — try another market.`,
        ctx,
      };
    return {
      text: `${r.meta.totalItems} buyer(s)${p ? ` for ${p.displayName}` : ''}${cc ? ` in ${countryLabel(cc)}` : ''}; top matches:${r.sampleData ? ' (includes sample/demo data)' : ''}`,
      table: {
        columns: [
          'Buyer',
          'Country',
          'Match',
          'Risk',
          'Contact confidence',
          'Source',
        ],
        rows: r.items.map((b) => [
          `${b.name}${b.demo ? ' (demo)' : ''}`,
          b.countryCode,
          `${b.match.score} ${b.match.level.toLowerCase()}`,
          b.risk.level.toLowerCase(),
          b.contactConfidence !== null ? `${b.contactConfidence}%` : 'unknown',
          `${b.provenance} · ${b.freshness.toLowerCase()}`,
        ]),
      },
      provenance: [
        {
          module: 'Buyer discovery',
          source:
            r.providers.map((x) => x.name).join(', ') || 'Buyer directory',
          freshness: null,
          asOf: r.calculatedAt,
          confidence: null,
        },
      ],
      links: [
        {
          label: 'Open buyer discovery',
          href: `/buyers?${new URLSearchParams({ ...(p ? { productId: p.id } : {}), ...(cc ? { country: cc } : {}) })}`,
        },
      ],
      suggestions: r.items
        .slice(0, 2)
        .filter((b) => !b.inCrm)
        .map((b) => ({
          label: `Add ${b.name} to CRM`,
          command: `Add ${b.name} to CRM`,
        })),
      ctx: { ...ctx, buyer: r.items[0]?.name ?? null },
    };
  }

  private async resolveInquiry(
    a: Actor,
    ref: string | null | undefined,
    cmd: (r: string) => string,
  ) {
    if (ref && /^c[a-z0-9]{20,}$/.test(ref)) {
      const d = await this.inquiries.detail(a, ref, false);
      return d;
    }
    const list = await this.inquiries.list(a, {
      search: ref ?? undefined,
      tab: 'rfq',
      pageSize: 6,
    } as never);
    if (ref) {
      const exact = list.items.filter(
        (i) => i.reference.toLowerCase() === ref.toLowerCase(),
      );
      if (exact.length === 1)
        return this.inquiries.detail(a, exact[0].id, false);
      if (list.items.length === 1)
        return this.inquiries.detail(a, list.items[0].id, false);
    }
    if (!list.items.length)
      throw new Clarify(
        ref ? `No RFQ matching “${ref}”.` : 'There are no RFQs yet.',
        [],
      );
    throw new Clarify(
      'Which RFQ?',
      list.items.map((i) => ({
        label: `${i.reference} · ${i.buyer.name}`,
        command: cmd(i.reference),
      })),
    );
  }

  private async inspectInquiry(
    a: Actor,
    ref: string | null | undefined,
  ): Promise<Part> {
    const d = await this.resolveInquiry(a, ref, (r) => `Summarize RFQ ${r}`);
    const c = d.confirmed;
    return {
      text: `${d.reference} from ${d.buyer.name} — status ${d.status.replace(/_/g, ' ').toLowerCase()}, approval ${d.approval.status.replace(/_/g, ' ').toLowerCase()}.`,
      bullets: c
        ? [
            ...c.items.map(
              (i) =>
                `${i.productName}: ${i.quantity ?? '?'} ${i.quantityUnit ?? ''}${i.targetPrice ? ` · buyer target ${i.priceCurrency ?? ''} ${i.targetPrice} (indicative)` : ''}`,
            ),
            `Destination: ${c.destination.countryCode ? countryLabel(c.destination.countryCode) : 'not stated'}${c.destination.port ? `, ${c.destination.port}` : ''}`,
            `Incoterm: ${c.incoterm.term ?? 'not stated'}${c.incoterm.place ? ` ${c.incoterm.place}` : ''}`,
          ]
        : [
            'RFQ data is not confirmed by a person yet — extraction/review is pending.',
          ],
      provenance: [
        {
          module: 'Inquiries',
          source: c
            ? `Human-confirmed RFQ (${c.confirmedBy ?? 'team'})`
            : 'Unconfirmed inquiry',
          freshness: null,
          asOf: c?.confirmedAt ?? d.receivedAt,
          confidence: null,
        },
      ],
      links: [{ label: 'Open RFQ', href: `/inquiries/${d.id}` }],
      suggestions: c
        ? [
            {
              label: 'Prepare quotation',
              command: `Prepare quotation for RFQ ${d.reference}`,
            },
          ]
        : [],
      ctx: { inquiry: d.id, inquiryRef: d.reference },
    };
  }

  private async missingDocs(
    a: Actor,
    shipmentRef: string | null,
  ): Promise<Part> {
    const d = await this.validation.dashboard(a);
    let missing = d.missing;
    if (shipmentRef) {
      const s = await this.shipments.list(a, {
        search: shipmentRef,
        pageSize: 2,
      } as never);
      if (s.items.length !== 1)
        throw new Clarify(
          `Which shipment? “${shipmentRef}” did not match exactly one.`,
          s.items.map((x) => ({
            label: x.shipmentNumber,
            command: `Which documents are missing for ${x.shipmentNumber}?`,
          })),
        );
      missing = missing.filter(
        (m) => m.purchaseOrderId === s.items[0].purchaseOrder.id,
      );
    }
    const rows = missing.flatMap((m) =>
      m.rows
        .filter(
          (r) =>
            ['MISSING_NOW', 'EXPECTED_LATER', 'UNKNOWN'].includes(r.state) ||
            (r.document &&
              ['NOT_RUN', 'NEEDS_REVIEW', 'FAILED'].includes(
                r.document.validationStatus,
              )),
        )
        .map((r) => [
          `PO ${m.poNumber} · ${m.buyerName}`,
          r.label,
          r.state === 'MISSING_NOW'
            ? 'missing now'
            : r.state === 'EXPECTED_LATER'
              ? 'expected later'
              : r.state === 'UNKNOWN'
                ? 'unknown — needs confirmation'
                : `validation ${r.document!.validationStatus.toLowerCase().replace(/_/g, ' ')}`,
          r.reason,
        ]),
    );
    const pending = d.needsValidation.length;
    return {
      text: rows.length
        ? `Document status for accepted orders (from compliance checklists and document validation):`
        : 'No missing documents for evaluated accepted orders.',
      table: rows.length
        ? {
            columns: ['Order', 'Document', 'State', 'Why'],
            rows: rows.slice(0, 25),
          }
        : null,
      bullets: [
        `${d.summary.missing} missing now`,
        `${pending} document(s) awaiting validation`,
        `${d.summary.critical} open critical validation finding(s)`,
      ],
      provenance: [
        {
          module: 'Compliance + document validation',
          source: 'Sprint 16 checklists / Sprint 17 validation',
          freshness: null,
          asOf: d.summary.lastValidationAt,
          confidence: null,
        },
      ],
      links: [
        {
          label: 'Validation dashboard',
          href: '/documents/validation?tab=missing',
        },
      ],
    };
  }

  private async shipmentStatus(
    a: Actor,
    ref: string | null,
    delayedOnly: boolean,
  ): Promise<Part> {
    if (ref) {
      const s = await this.shipments.list(a, {
        search: ref,
        pageSize: 3,
      } as never);
      if (s.items.length !== 1)
        throw new Clarify(
          s.items.length ? 'Which shipment?' : `No shipment matching “${ref}”.`,
          s.items.map((x) => ({
            label: x.shipmentNumber,
            command: `Shipment status ${x.shipmentNumber}`,
          })),
        );
      const x = s.items[0];
      return {
        text: `${x.shipmentNumber} (${x.buyer.name}): ${x.status.replace(/_/g, ' ').toLowerCase()}, health ${x.health.replace(/_/g, ' ').toLowerCase()}, ETA ${x.eta?.slice(0, 10) ?? 'not set'}, ${x.openExceptions} open exception(s).`,
        links: [{ label: 'Open shipment', href: `/shipments/${x.id}` }],
        ctx: { shipment: x.shipmentNumber },
        provenance: [
          {
            module: 'Logistics',
            source:
              'Recorded tracking events (manual/forwarder unless a provider is configured)',
            freshness: null,
            asOf: x.updatedAt,
            confidence: null,
          },
        ],
      };
    }
    const o = await this.shipments.overview(a);
    const l = await this.shipments.list(a, {
      health: delayedOnly ? 'DELAYED' : undefined,
      pageSize: 10,
    } as never);
    return {
      text: `${o.active} active shipment(s): ${o.delayed} delayed, ${o.departingSoon} departing and ${o.arrivingSoon} arriving in 7 days, ${o.customsHolds} customs hold(s).`,
      table: l.items.length
        ? {
            columns: ['Shipment', 'Buyer', 'Status', 'Health', 'ETA'],
            rows: l.items.map((x) => [
              x.shipmentNumber,
              x.buyer.name,
              x.status.replace(/_/g, ' ').toLowerCase(),
              x.health.replace(/_/g, ' ').toLowerCase(),
              x.eta?.slice(0, 10) ?? '—',
            ]),
          }
        : null,
      links: [
        {
          label: delayedOnly ? 'Delayed shipments' : 'Shipments',
          href: delayedOnly ? '/shipments?health=DELAYED' : '/shipments',
        },
      ],
      provenance: [
        {
          module: 'Logistics',
          source: 'Shipment lifecycle and health (logistics service)',
          freshness: null,
          asOf: new Date().toISOString(),
          confidence: null,
        },
      ],
    };
  }

  private async exceptions(a: Actor): Promise<Part> {
    const r = await this.shipments.exceptions(a, {
      status: 'OPEN',
      pageSize: 15,
    } as never);
    return {
      text: r.items.length
        ? `${r.meta.totalItems} open shipment exception(s):`
        : 'No open shipment exceptions.',
      table: r.items.length
        ? {
            columns: ['Shipment', 'Severity', 'Exception', 'Detected'],
            rows: r.items.map((e) => [
              e.shipment?.shipmentNumber ?? '—',
              e.severity.toLowerCase(),
              e.title,
              e.detectedAt.slice(0, 10),
            ]),
          }
        : null,
      links: [{ label: 'Exceptions', href: '/shipments/exceptions' }],
    };
  }

  private async overdue(a: Actor): Promise<Part> {
    const r = await this.receivables.list(a, {
      status: 'OVERDUE',
      pageSize: 15,
    } as never);
    return {
      text: r.items.length
        ? `${r.meta.totalItems} overdue receivable(s):`
        : 'No overdue receivables.',
      table: r.items.length
        ? {
            columns: ['Receivable', 'Buyer', 'Outstanding', 'Days overdue'],
            rows: r.items.map((x) => [
              x.receivableNumber,
              x.buyer.name,
              `${x.currency} ${x.outstandingAmount}`,
              String(x.daysOverdue ?? '—'),
            ]),
          }
        : null,
      links: [
        {
          label: 'Overdue receivables',
          href: '/finance/receivables?status=OVERDUE',
        },
      ],
      suggestions:
        r.items[0] && this.can(a, 'receivables.manage')
          ? [
              {
                label: `Draft reminder for ${r.items[0].receivableNumber}`,
                command: `Draft payment reminder ${r.items[0].receivableNumber}`,
              },
            ]
          : [],
      provenance: [
        {
          module: 'Finance',
          source: 'Receivables (read-time due status)',
          freshness: null,
          asOf: new Date().toISOString(),
          confidence: null,
        },
      ],
      ctx: r.items[0] ? { receivable: r.items[0].receivableNumber } : {},
    };
  }

  private async profit(a: Actor): Promise<Part> {
    const r = await this.financeAnalytics.buyers(a, { range: 'year' } as never);
    if (!r.rows.length)
      return {
        text: `No finalized shipment profitability this year (${r.meta.inProgressCount} in progress are excluded until finalized).`,
        links: [{ label: 'Profitability', href: '/profitability' }],
      };
    const rev = r.rows.reduce((s, x) => s + Number(x.revenue), 0);
    const prof = r.rows.reduce((s, x) => s + Number(x.grossProfit), 0);
    return {
      text: `Finalized this year: revenue ${r.meta.reportingCurrency} ${rev.toFixed(2)}, profit ${prof.toFixed(2)} (${rev ? ((prof / rev) * 100).toFixed(1) : '—'}% margin) across ${r.meta.finalizedCount} shipment(s).`,
      table: {
        columns: ['Buyer', 'Revenue', 'Profit', 'Margin'],
        rows: r.rows
          .slice(0, 8)
          .map((x) => [
            x.buyer.name,
            x.revenue,
            x.grossProfit,
            x.marginPercent ? `${x.marginPercent}%` : '—',
          ]),
      },
      bullets: r.insights,
      provenance: [
        {
          module: 'Profitability',
          source: r.meta.basis,
          freshness: null,
          asOf: r.meta.calculatedAt,
          confidence: null,
        },
      ],
      links: [{ label: 'Profitability', href: '/profitability' }],
    };
  }

  private async reorder(a: Actor): Promise<Part> {
    const r = await this.financeAnalytics.repeatBusiness(a);
    const due = [...r.dueForReorder, ...r.overdueFollowUp];
    return {
      text: due.length
        ? 'Buyers due (or past due) for a reorder:'
        : 'No buyers are near their reorder window.',
      table: due.length
        ? {
            columns: ['Buyer', 'Signal', 'Window', 'Usually orders'],
            rows: due.map((s) => [
              s.buyer.name,
              `${s.level.toLowerCase()} (${s.score ?? '—'} pts)`,
              s.window ? `${s.window.start} – ${s.window.end}` : '—',
              s.topProducts[0]?.name ?? '—',
            ]),
          }
        : null,
      bullets: [r.method],
      links: [{ label: 'Repeat business', href: '/repeat-business' }],
    };
  }

  private async attention(
    a: Actor,
    types: string[] | null,
    title: string,
  ): Promise<Part> {
    await this.automation.evaluate(a).catch(() => undefined);
    const s = await this.automation.settings(a.organizationId);
    const l = await this.actions.list(a, { pageSize: 50 }, s.lastEvaluatedAt);
    const items = l.items
      .filter((i) => !types || types.includes(i.type))
      .slice(0, 10);
    return {
      text: items.length ? title : 'Nothing urgent right now.',
      table: items.length
        ? {
            columns: ['Priority', 'Item', 'Due', 'Next step'],
            rows: items.map((i) => [
              i.priority.toLowerCase(),
              i.title,
              i.dueAt?.slice(0, 10) ?? '—',
              i.suggestedAction ?? '',
            ]),
          }
        : null,
      bullets: items.length
        ? [
            `Priority is deterministic (severity, exposure, overdue days, deadlines) — ${l.summary.critical} critical, ${l.summary.open} open in total.`,
          ]
        : [],
      links: [{ label: 'Action Center', href: '/action-center' }],
    };
  }

  private async summary(a: Actor): Promise<Part> {
    const o = await this.analytics.overview(a, { range: 'month' });
    return {
      text: `This month (${o.range.from} – ${o.range.to}):`,
      bullets: [
        ...o.cards.map(
          (c) =>
            `${c.label}: ${c.value === null ? 'not available' : `${c.currency ? `${c.currency} ` : ''}${c.value}`}`,
        ),
        ...o.insights.map((i) => i.text),
      ],
      links: [{ label: 'Executive analytics', href: '/analytics' }],
      provenance: [
        {
          module: 'Analytics',
          source: 'Computed from module data (no predictions)',
          freshness: null,
          asOf: o.calculatedAt,
          confidence: null,
        },
      ],
    };
  }

  // ---------------------------------------------------------------- write proposals

  private async propose(
    a: Actor,
    conversationId: string,
    action: AiActionName,
    target: string,
    params: Record<string, unknown>,
    values: { label: string; value: string }[],
    effect: string,
  ): Promise<AiActionPreview> {
    const hash = createHash('sha256')
      .update(JSON.stringify([a.userId, action, params]))
      .digest('hex')
      .slice(0, 40);
    const recent = await this.prisma.aiActionExecution.findFirst({
      where: {
        organizationId: a.organizationId,
        idempotencyKey: { startsWith: hash },
        OR: [
          { status: 'PROPOSED' },
          {
            status: 'EXECUTED',
            executedAt: { gte: new Date(Date.now() - 10 * 60000) },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent)
      return {
        ...(recent.preview as unknown as AiActionPreview),
        executionId: recent.id,
        status: recent.status as AiActionPreview['status'],
      };
    const def = AI_ACTIONS[action];
    const preview: Omit<AiActionPreview, 'executionId'> = {
      action,
      label: def.label,
      target,
      values,
      effect,
      status: 'PROPOSED',
    };
    const row = await this.prisma.aiActionExecution.create({
      data: {
        organizationId: a.organizationId,
        userId: a.userId,
        conversationId,
        action,
        kind: def.kind,
        label: def.label,
        target,
        params: params as Prisma.InputJsonValue,
        preview: preview as unknown as Prisma.InputJsonValue,
        idempotencyKey: `${hash}:${randomUUID()}`,
      },
    });
    return { ...preview, executionId: row.id };
  }

  private async proposeLead(
    a: Actor,
    conv: string,
    buyerName: string | null | undefined,
    productName: string | null | undefined,
    countryRaw: string | null | undefined,
  ): Promise<Part> {
    if (!buyerName) throw new Clarify('Which buyer should I add to CRM?', []);
    const cc = this.country(countryRaw, false);
    const p = productName
      ? await this.product(
          a,
          productName,
          (n) => `Add ${buyerName} to CRM for ${n}`,
        )
      : null;
    // Buyer identity is resolved by name only; the product context is attached to the lead, not used to filter.
    const r = await this.buyers.search(a.organizationId, {
      country: cc ?? undefined,
      pageSize: 50,
    } as never);
    const hits = r.items.filter((b) =>
      b.name.toLowerCase().includes(buyerName.toLowerCase()),
    );
    const exact = hits.filter(
      (b) => b.name.toLowerCase() === buyerName.toLowerCase(),
    );
    const b =
      exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
    if (!b)
      throw new Clarify(
        hits.length
          ? `Several buyers match “${buyerName}”. Which one?`
          : `No discovered buyer named “${buyerName}”${cc ? ` in ${countryLabel(cc)}` : ''}.`,
        hits.slice(0, 6).map((h) => ({
          label: `${h.name} (${h.countryCode})`,
          command: `Add ${h.name} to CRM`,
        })),
      );
    if (b.inCrm)
      return {
        text: `${b.name} is already in your CRM.`,
        links: [{ label: 'Open CRM', href: '/crm' }],
      };
    const preview = await this.propose(
      a,
      conv,
      'create_crm_lead',
      b.name,
      {
        buyerId: b.id,
        productId: p?.id ?? null,
        countryCode: cc ?? b.countryCode,
      },
      [
        { label: 'Buyer', value: `${b.name} (${b.countryCode})` },
        { label: 'Product', value: p?.displayName ?? 'not set' },
        { label: 'Market', value: countryLabel(cc ?? b.countryCode) },
      ],
      'Creates a CRM lead at stage NEW. No message is sent to the buyer.',
    );
    return { text: 'Please confirm:', preview, ctx: { buyer: b.name } };
  }

  private async proposeQuotation(
    a: Actor,
    conv: string,
    ref: string | null | undefined,
  ): Promise<Part> {
    const d = await this.resolveInquiry(
      a,
      ref,
      (r) => `Prepare quotation for RFQ ${r}`,
    );
    const c = d.confirmed;
    const missing: string[] = [];
    if (!c)
      missing.push(
        'RFQ data is not confirmed by a person (review the extraction first).',
      );
    const existing = (
      await this.quotations.list(a, { inquiryId: d.id, pageSize: 1 } as never)
    ).items[0];
    if (existing)
      return {
        text: `Quotation ${existing.displayNumber} already exists for ${d.reference}.`,
        links: [
          { label: 'Open quotation', href: `/quotations/${existing.id}` },
        ],
        ctx: { inquiry: d.id },
      };
    if (c) {
      for (const i of c.items)
        if (!i.quantity) missing.push(`Quantity for ${i.productName}`);
      if (!c.destination.countryCode) missing.push('Destination country');
      if (!c.incoterm.term) missing.push('Incoterm');
    }
    const productIds = (c?.items ?? [])
      .map((i) => i.productId)
      .filter((x): x is string => !!x);
    const costings = productIds.length
      ? await this.prisma.exportCosting.count({
          where: {
            organizationId: a.organizationId,
            productId: { in: productIds },
            status: { in: ['READY', 'LOCKED'] },
          },
        })
      : 0;
    const plan = [
      c ? '✓ RFQ confirmed by a person' : '✗ RFQ not confirmed',
      costings
        ? `✓ ${costings} READY/LOCKED costing(s) exist for these products — link them on the draft to price from costing`
        : '• No READY costing — unit prices stay blank for you to enter (never estimated)',
      ...missing.map((m) => `✗ Missing: ${m}`),
    ];
    if (!c)
      return {
        text: `I can’t propose a quotation for ${d.reference} yet.`,
        bullets: plan,
        links: [{ label: 'Review RFQ', href: `/inquiries/${d.id}` }],
        ctx: { inquiry: d.id },
      };
    const preview = await this.propose(
      a,
      conv,
      'prepare_quotation',
      `${d.reference} · ${d.buyer.name}`,
      { inquiryId: d.id },
      [
        { label: 'Buyer', value: d.buyer.name },
        {
          label: 'Items',
          value: c.items
            .map(
              (i) =>
                `${i.productName} ${i.quantity ?? '?'} ${i.quantityUnit ?? ''}`,
            )
            .join('; '),
        },
        {
          label: 'Incoterm',
          value: `${c.incoterm.term ?? 'not stated'}${c.incoterm.place ? ` ${c.incoterm.place}` : ''}`,
        },
        {
          label: 'Destination',
          value: c.destination.countryCode
            ? countryLabel(c.destination.countryCode)
            : 'not stated',
        },
      ],
      'Creates a DRAFT quotation from the confirmed RFQ via the quotation service. Nothing is issued or sent; prices are not filled in by AI.',
    );
    return {
      text: 'Here is the plan — confirm to create the draft quotation:',
      bullets: plan,
      preview,
      ctx: { inquiry: d.id, inquiryRef: d.reference },
    };
  }

  private async resolveReceivable(
    a: Actor,
    ref: string | null | undefined,
    cmd: (r: string) => string,
  ) {
    if (!ref) {
      const l = await this.receivables.list(a, {
        status: 'OPEN',
        pageSize: 6,
      } as never);
      throw new Clarify(
        'Which receivable?',
        l.items.map((x) => ({
          label: `${x.receivableNumber} · ${x.buyer.name} · ${x.currency} ${x.outstandingAmount}`,
          command: cmd(x.receivableNumber),
        })),
      );
    }
    const l = await this.receivables.list(a, {
      search: ref,
      pageSize: 3,
    } as never);
    const exact = l.items.filter(
      (x) => x.receivableNumber.toLowerCase() === ref.toLowerCase(),
    );
    const r =
      exact.length === 1 ? exact[0] : l.items.length === 1 ? l.items[0] : null;
    if (!r)
      throw new Clarify(
        l.items.length
          ? 'Which receivable?'
          : `No receivable matching “${ref}”.`,
        l.items.map((x) => ({
          label: x.receivableNumber,
          command: cmd(x.receivableNumber),
        })),
      );
    return this.receivables.detail(a, r.id);
  }

  private async proposePayment(
    a: Actor,
    conv: string,
    e: AiIntent['entities'],
  ): Promise<Part> {
    // Amount, currency and receivable must come from the user — never inferred.
    const missing = [
      !e.receivable && 'receivable number (RCV-…)',
      !e.amount && 'amount received',
      !e.currency && 'currency',
    ].filter(Boolean) as string[];
    if (missing.length)
      return {
        text: `To record a payment I need: ${missing.join(', ')}. Example: “Record payment of USD 5000 for RCV-2026-000001 ref UTR123”.`,
        clarification: {
          question: `Missing: ${missing.join(', ')}`,
          options: [],
        },
      };
    const r = await this.resolveReceivable(
      a,
      e.receivable,
      (x) =>
        `Record payment of ${e.currency} ${e.amount} for ${x}${e.reference ? ` ref ${e.reference}` : ''}`,
    );
    const preview = await this.propose(
      a,
      conv,
      'record_payment',
      `${r.receivableNumber} · ${r.buyer.name}`,
      {
        receivableId: r.id,
        amount: e.amount,
        currency: e.currency!.toUpperCase(),
        reference: e.reference ?? null,
        receivedAt: today(),
        expectedRowVersion: r.rowVersion,
      },
      [
        {
          label: 'Receivable',
          value: `${r.receivableNumber} (${r.currency} ${r.outstandingAmount} outstanding)`,
        },
        { label: 'Amount', value: `${e.currency!.toUpperCase()} ${e.amount}` },
        { label: 'Received on', value: today() },
        {
          label: 'Bank reference',
          value: e.reference ? `••••${e.reference.slice(-4)}` : 'none',
        },
      ],
      'Records the payment through the receivables service (applies to the oldest outstanding installment). Duplicate references, overpayments and missing FX are rejected there.',
    );
    return {
      text: 'Please confirm the payment you received:',
      preview,
      ctx: { receivable: r.receivableNumber },
    };
  }

  /** Low-risk write: creates an unsent reminder draft directly (Sprint 19 workflow). */
  private async draftReminder(
    a: Actor,
    conv: string,
    ref: string | null | undefined,
  ): Promise<Part> {
    const r = await this.resolveReceivable(
      a,
      ref,
      (x) => `Draft payment reminder ${x}`,
    );
    const exec = await this.prisma.aiActionExecution.create({
      data: {
        organizationId: a.organizationId,
        userId: a.userId,
        conversationId: conv,
        action: 'draft_payment_reminder',
        kind: 'WRITE',
        label: AI_ACTIONS.draft_payment_reminder.label,
        target: r.receivableNumber,
        params: { receivableId: r.id } as Prisma.InputJsonValue,
        preview: {} as Prisma.InputJsonValue,
        idempotencyKey: randomUUID(),
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
    try {
      await this.receivables.createReminder(a, r.id, {});
      await this.prisma.aiActionExecution.update({
        where: { id: exec.id },
        data: {
          status: 'EXECUTED',
          executedAt: new Date(),
          result: {
            href: `/finance/receivables/${r.id}`,
            message: 'Reminder draft created (not sent)',
          } as Prisma.InputJsonValue,
        },
      });
      await this.audit.record({
        organizationId: a.organizationId,
        actorId: a.userId,
        action: 'ai.action.executed',
        entityType: 'Receivable',
        entityId: r.id,
        metadata: {
          action: 'draft_payment_reminder',
          aiAssisted: true,
          executionId: exec.id,
        },
      });
    } catch (err) {
      await this.prisma.aiActionExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 500) },
      });
      throw err;
    }
    return {
      text: `Drafted a payment reminder for ${r.receivableNumber}. It is NOT sent — review, copy and send it yourself, then record it.`,
      links: [
        { label: 'Open receivable', href: `/finance/receivables/${r.id}` },
      ],
      ctx: { receivable: r.receivableNumber },
    };
  }

  // ---------------------------------------------------------------- confirm / cancel

  private viewExec(
    e: Prisma.AiActionExecutionGetPayload<object>,
  ): AiExecutionView {
    const res = e.result as { href: string | null; message: string } | null;
    return {
      id: e.id,
      action: e.action as AiActionName,
      label: e.label,
      target: e.target,
      status: e.status as AiExecutionView['status'],
      result: res,
      error: e.error,
      createdAt: e.createdAt.toISOString(),
      executedAt: e.executedAt?.toISOString() ?? null,
    };
  }

  async executions(a: Actor) {
    const rows = await this.prisma.aiActionExecution.findMany({
      where: { organizationId: a.organizationId, userId: a.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.viewExec(r));
  }

  async cancel(a: Actor, id: string) {
    const e = await this.prisma.aiActionExecution.findFirst({
      where: { id, organizationId: a.organizationId, userId: a.userId },
    });
    if (!e) throw new NotFoundException('Action not found.');
    const n = await this.prisma.aiActionExecution.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'CANCELLED' },
    });
    if (!n.count)
      throw new ConflictException(
        `This action is already ${e.status.toLowerCase()}.`,
      );
    return this.viewExec(
      await this.prisma.aiActionExecution.findUniqueOrThrow({ where: { id } }),
    );
  }

  /** Executes a confirmed proposal exactly once via the domain service; retries return the first result. */
  async confirm(a: Actor, id: string): Promise<AiConfirmResult> {
    const e = await this.prisma.aiActionExecution.findFirst({
      where: { id, organizationId: a.organizationId, userId: a.userId },
    });
    if (!e) throw new NotFoundException('Action not found.');
    if (e.status === 'EXECUTED' || e.status === 'FAILED')
      return { execution: this.viewExec(e), next: [] };
    const def = AI_ACTIONS[e.action as AiActionName];
    if (!def || def.kind !== 'WRITE')
      throw new ConflictException('Unknown action.');
    if (!this.can(a, def.permission) || !this.can(a, 'ai_manager.execute'))
      throw new ForbiddenException(
        `Missing required permission: ${def.permission}`,
      );
    const n = await this.prisma.aiActionExecution.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    if (!n.count) {
      const cur = await this.prisma.aiActionExecution.findUniqueOrThrow({
        where: { id },
      });
      if (cur.status === 'CANCELLED')
        throw new ConflictException('This action was cancelled.');
      return { execution: this.viewExec(cur), next: [] };
    }
    const p = e.params as Record<string, string | number | null>;
    let result: {
      href: string | null;
      message: string;
      entityType: string;
      entityId: string;
    };
    let next: { label: string; command: string }[] = [];
    try {
      switch (e.action as AiActionName) {
        case 'create_crm_lead': {
          const r = await this.buyers.addToCrm(a, String(p.buyerId), {
            productId: (p.productId as string) ?? undefined,
            countryCode: (p.countryCode as string) ?? undefined,
          } as never);
          result = {
            href: `/crm/leads/${r.leadId}`,
            message: r.alreadyAdded
              ? 'Buyer was already in CRM.'
              : 'CRM lead created.',
            entityType: 'BuyerLead',
            entityId: r.leadId,
          };
          next = [
            {
              label: 'Who to follow up today',
              command: 'Who should I follow up today?',
            },
          ];
          break;
        }
        case 'prepare_quotation': {
          const q = await this.quotations.create(a, {
            inquiryId: String(p.inquiryId),
          } as never);
          result = {
            href: `/quotations/${q.id}`,
            message: `Draft quotation ${q.displayNumber} created — review prices and terms before issuing.`,
            entityType: 'Quotation',
            entityId: q.id,
          };
          next = [
            {
              label: 'Check missing documents',
              command: 'Which shipment documents are missing?',
            },
          ];
          break;
        }
        case 'record_payment': {
          const r = await this.receivables.recordPayment(
            a,
            String(p.receivableId),
            {
              amount: String(p.amount),
              currency: String(p.currency),
              receivedAt: String(p.receivedAt),
              paymentMethod: 'BANK_TRANSFER',
              bankReference: (p.reference as string) ?? undefined,
              expectedRowVersion: Number(p.expectedRowVersion),
            } as never,
          );
          result = {
            href: `/finance/receivables/${r.id}`,
            message: `Payment recorded — ${r.currency} ${r.outstandingAmount} outstanding (${r.status.replace(/_/g, ' ').toLowerCase()}).`,
            entityType: 'Receivable',
            entityId: r.id,
          };
          next = [
            {
              label: 'Show overdue payments',
              command: 'Show overdue payments',
            },
          ];
          break;
        }
        default:
          throw new ConflictException('Unsupported action.');
      }
    } catch (err) {
      const msg = (err as Error).message;
      await this.prisma.aiActionExecution.update({
        where: { id },
        data: { status: 'FAILED', error: msg.slice(0, 500) },
      });
      return {
        execution: this.viewExec(
          await this.prisma.aiActionExecution.findUniqueOrThrow({
            where: { id },
          }),
        ),
        next: [],
      };
    }
    await this.prisma.aiActionExecution.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
        result: {
          href: result.href,
          message: result.message,
        } as Prisma.InputJsonValue,
        preview: {
          ...(e.preview as object),
          status: 'EXECUTED',
        } as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'ai.action.executed',
      entityType: result.entityType,
      entityId: result.entityId,
      metadata: {
        action: e.action,
        target: e.target,
        aiAssisted: true,
        executionId: id,
      },
    });
    return {
      execution: this.viewExec(
        await this.prisma.aiActionExecution.findUniqueOrThrow({
          where: { id },
        }),
      ),
      next,
    };
  }
}

const AI_NAMES_FOR_PROMPT = AI_ACTION_NAMES.map((n) => ({
  name: n,
  description: AI_ACTIONS[n].description,
}));
