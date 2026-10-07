import { randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  type BuyerOutreachHistory,
  type CampaignAnalytics,
  type CampaignCounts,
  type CampaignDetail,
  type CampaignListResponse,
  type CampaignSummary,
  countryLabel,
  CRM_STAGES,
  type CrmStage,
  type DeliveryMode,
  type ExclusionReason,
  type GeneratedContent,
  isValidCountryCode,
  type LaunchCheck,
  type MessageListResponse,
  type OutreachMessageDetail,
  type OutreachMessageView,
  type OutreachProviderStatus,
  type OutreachSettings,
  type OutreachTemplate,
  OUTREACH_DEFAULT_LIMITS,
  OUTREACH_LANGUAGES,
  type ProviderCapabilities,
  type RecipientListResponse,
  type RecipientView,
  type RenderedPreview,
  type SuppressionView,
  type TemplateValidation,
} from '@exportpro/types';
import type { AppConfig } from '../../config/configuration';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryIntakeService } from '../inquiries/inquiry-intake.service';
import { AuditService } from '../audit/audit.service';
import { riskLevel } from '../buyers/buyer-scoring';
import { sanitizeText } from '../buyers/buyer-normalization';
import { OutreachEventsService } from './outreach-events.service';
import {
  OutreachProcessorService,
  startOfUtcDay,
} from './outreach-processor.service';
import {
  exclusionReason,
  extractVariables,
  normalizeAddress,
  pickEmailContact,
  rate,
  render,
  safeUrl,
  textToHtml,
  unsupportedClaims,
  validateTemplate,
  type VariableValues,
  withFooter,
} from './outreach-rules';
import {
  ContentProviderError,
  OUTREACH_CONTENT_PROVIDER,
  type OutreachContentProvider,
} from './providers/content-provider';
import { DevelopmentOutreachProvider } from './providers/development.provider';
import {
  OUTREACH_PROVIDER,
  type OutreachProvider,
} from './providers/outreach-provider';
import type {
  CampaignListQueryDto,
  CreateCampaignDto,
  GenerateDto,
  MessageQueryDto,
  SettingsDto,
  TemplateDto,
  UpdateCampaignDto,
  UpdateTemplateDto,
} from './outreach.dto';

export type Actor = { organizationId: string; userId: string };

const DAY_MS = 86_400_000;
const MAX_LAUNCHES_PER_HOUR = 10;
const MAX_TESTS_PER_HOUR = 10;
const MAX_SCHEDULE_DAYS = 90;
const PREVIEW_COUNT = 5;
const INTERESTED_FROM = CRM_STAGES.indexOf('INTERESTED');
const CONVERTED_FROM = CRM_STAGES.indexOf('QUALIFIED');

/** Stage reached = INTERESTED (or QUALIFIED) or later; LOST never counts. */
const stageAtLeast = (stage: CrmStage | undefined, from: number) =>
  Boolean(stage && stage !== 'LOST' && CRM_STAGES.indexOf(stage) >= from);

const METHODOLOGY: Record<string, string> = {
  sent: 'Unique recipients with at least one sent message (test sends excluded).',
  delivered:
    'Unique recipients with a provider “delivered” event. Unavailable when the provider does not report delivery.',
  opened:
    'Unique recipients with a provider open signal. Open tracking is imperfect (image blocking, privacy proxies) and does not prove a human read the email.',
  replied:
    'Unique recipients with a recorded reply. Replies are marked manually unless the provider reports inbound replies.',
  bounced: 'Unique recipients whose message hard-bounced.',
  interested:
    'Recipients marked Interested, or whose linked CRM lead is at Interested or a later stage (Lost excluded). A reply alone does not count.',
  converted:
    'Recipients whose linked CRM lead reached Qualified or a later stage (Lost excluded).',
  deliveryRate: 'Delivered ÷ Sent.',
  openRate: 'Opened ÷ Delivered (only when the provider reports opens).',
  replyRate:
    'Replied ÷ Sent (sent is used because delivery is not always reported).',
};

const DEV_CAPS: ProviderCapabilities = new DevelopmentOutreachProvider()
  .capabilities;

@Injectable()
export class OutreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: OutreachEventsService,
    private readonly processor: OutreachProcessorService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(OUTREACH_PROVIDER) private readonly provider: OutreachProvider,
    @Inject(OUTREACH_CONTENT_PROVIDER)
    private readonly content: OutreachContentProvider,
    private readonly intake: InquiryIntakeService,
  ) {}

  // ============================================================ provider

  providerStatus(): OutreachProviderStatus {
    const p = this.provider;
    return {
      provider: p.name,
      label: p.label,
      deliveryMode: p.deliveryMode,
      configured: p.configured,
      capabilities: p.capabilities,
      webhookConfigured: p.webhookConfigured,
      message:
        p.deliveryMode === 'DEVELOPMENT'
          ? 'Development delivery only — messages are recorded in ExportPro and never sent to buyers.'
          : p.configured
            ? 'Real email delivery is configured.'
            : 'Email sending is not configured.',
    };
  }

  private get mode(): DeliveryMode {
    return this.provider.deliveryMode;
  }

  private capsFor(c: {
    deliveryMode: DeliveryMode | null;
    provider: string | null;
  }): ProviderCapabilities {
    if (c.deliveryMode === 'DEVELOPMENT') return DEV_CAPS;
    if (c.provider && c.provider === this.provider.name)
      return this.provider.capabilities;
    return c.deliveryMode === 'PRODUCTION'
      ? this.provider.capabilities
      : DEV_CAPS;
  }

  // ============================================================ settings

  private async settingsRow(organizationId: string) {
    return this.prisma.organizationOutreachSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...OUTREACH_DEFAULT_LIMITS },
      update: {},
    });
  }

  private async branding(organizationId: string) {
    const [s, org] = await Promise.all([
      this.settingsRow(organizationId),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, website: true, timezone: true },
      }),
    ]);
    return {
      s,
      companyName: s.companyName?.trim() || org.name,
      website: safeUrl(s.companyWebsite) ?? safeUrl(org.website),
      orgDefaults: {
        companyName: org.name,
        companyWebsite: safeUrl(org.website),
      },
    };
  }

  async getSettings(organizationId: string): Promise<OutreachSettings> {
    const { s, orgDefaults } = await this.branding(organizationId);
    const sentToday = await this.prisma.outreachMessage.count({
      where: {
        organizationId,
        testSend: false,
        sentAt: { gte: startOfUtcDay(new Date()) },
      },
    });
    return {
      fromName: s.fromName,
      fromEmail: s.fromEmail,
      replyTo: s.replyTo,
      companyName: s.companyName,
      companyWebsite: s.companyWebsite,
      signature: s.signature,
      dailyLimit: s.dailyLimit,
      maxRecipientsPerCampaign: s.maxRecipientsPerCampaign,
      maxFollowUps: s.maxFollowUps,
      contactCooldownDays: s.contactCooldownDays,
      timezone: s.timezone,
      enabled: s.enabled,
      // The development provider can never report VERIFIED.
      domainStatus:
        this.mode === 'DEVELOPMENT' ? 'DEVELOPMENT_ONLY' : s.domainStatus,
      domainCheckedAt: s.domainCheckedAt?.toISOString() ?? null,
      domainMessage: s.domainMessage,
      provider: this.providerStatus(),
      defaults: orgDefaults,
      sentToday,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async updateSettings(a: Actor, dto: SettingsDto) {
    await this.settingsRow(a.organizationId);
    if (dto.companyWebsite && !safeUrl(dto.companyWebsite))
      throw new BadRequestException('Enter a valid public website URL.');
    if (dto.timezone && !isValidTimezone(dto.timezone))
      throw new BadRequestException('Choose a valid timezone.');
    const data: Prisma.OrganizationOutreachSettingsUpdateInput = {};
    const fields: string[] = [];
    const set = <K extends keyof SettingsDto>(k: K, v: unknown) => {
      if (dto[k] === undefined) return;
      (data as Record<string, unknown>)[k] = v;
      fields.push(k);
    };
    set('fromName', sanitizeText(dto.fromName ?? undefined, 80));
    set('fromEmail', dto.fromEmail ? dto.fromEmail.trim().toLowerCase() : null);
    set('replyTo', dto.replyTo ? dto.replyTo.trim().toLowerCase() : null);
    set('companyName', sanitizeText(dto.companyName ?? undefined, 120));
    set(
      'companyWebsite',
      dto.companyWebsite ? safeUrl(dto.companyWebsite) : null,
    );
    set(
      'signature',
      dto.signature?.trim() ? dto.signature.trim().slice(0, 1000) : null,
    );
    set('dailyLimit', dto.dailyLimit);
    set('maxRecipientsPerCampaign', dto.maxRecipientsPerCampaign);
    set('maxFollowUps', dto.maxFollowUps);
    set('contactCooldownDays', dto.contactCooldownDays);
    set('timezone', dto.timezone);
    set('enabled', dto.enabled);
    // A changed sender must be re-verified with the provider.
    if (dto.fromEmail !== undefined)
      Object.assign(data, {
        domainStatus: 'NOT_CONFIGURED',
        domainCheckedAt: null,
        domainMessage: null,
      });
    await this.prisma.organizationOutreachSettings.update({
      where: { organizationId: a.organizationId },
      data,
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'outreach.settings_updated',
      entityType: 'OrganizationOutreachSettings',
      entityId: a.organizationId,
      metadata: { fields },
    });
    return this.getSettings(a.organizationId);
  }

  async verifyDomain(a: Actor) {
    const s = await this.settingsRow(a.organizationId);
    const r = await this.provider.validateConfiguration(s.fromEmail);
    await this.prisma.organizationOutreachSettings.update({
      where: { organizationId: a.organizationId },
      data: {
        domainStatus: r.status,
        domainMessage: r.message,
        domainCheckedAt: new Date(),
      },
    });
    return this.getSettings(a.organizationId);
  }

  // =========================================================== templates

  private toTemplate(
    t: Prisma.OutreachTemplateGetPayload<object>,
    names: Map<string, string>,
  ): OutreachTemplate {
    return {
      id: t.id,
      system: t.organizationId === null,
      name: t.name,
      type: t.type,
      subject: t.subject,
      body: t.body,
      language: t.language,
      variables: t.variables,
      active: t.active,
      version: t.version,
      createdBy: t.createdByUserId
        ? (names.get(t.createdByUserId) ?? null)
        : null,
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private async names(ids: (string | null | undefined)[]) {
    const u = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const users = u.length
      ? await this.prisma.user.findMany({
          where: { id: { in: u } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    return new Map(
      users.map((x) => [x.id, `${x.firstName} ${x.lastName}`.trim()]),
    );
  }

  async templates(organizationId: string, includeArchived = false) {
    const rows = await this.prisma.outreachTemplate.findMany({
      where: {
        OR: [{ organizationId: null }, { organizationId }],
        ...(includeArchived ? {} : { active: true }),
      },
      orderBy: [
        { organizationId: { sort: 'asc', nulls: 'first' } },
        { type: 'asc' },
        { name: 'asc' },
      ],
    });
    const names = await this.names(rows.map((r) => r.createdByUserId));
    return rows.map((r) => this.toTemplate(r, names));
  }

  private async visibleTemplate(organizationId: string, id: string) {
    const t = await this.prisma.outreachTemplate.findFirst({
      where: { id, OR: [{ organizationId: null }, { organizationId }] },
    });
    if (!t) throw new NotFoundException('Template not found.');
    return t;
  }

  private assertValid(subject: string, body: string) {
    const v = validateTemplate(subject, body);
    if (!v.valid) throw new BadRequestException(v.errors.join(' '));
    return v;
  }

  async createTemplate(a: Actor, dto: TemplateDto) {
    this.assertValid(dto.subject, dto.body);
    const t = await this.prisma.outreachTemplate.create({
      data: {
        organizationId: a.organizationId,
        name: dto.name.trim(),
        type: dto.type,
        subject: dto.subject.trim(),
        body: dto.body.trim(),
        language: dto.language ?? 'en',
        variables: extractVariables(`${dto.subject}\n${dto.body}`),
        createdByUserId: a.userId,
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'template.created',
      entityType: 'OutreachTemplate',
      entityId: t.id,
      metadata: { type: t.type },
    });
    return this.toTemplate(t, await this.names([t.createdByUserId]));
  }

  async updateTemplate(a: Actor, id: string, dto: UpdateTemplateDto) {
    const t = await this.visibleTemplate(a.organizationId, id);
    if (t.organizationId === null)
      throw new BadRequestException(
        'System templates are read-only. Duplicate it to customize.',
      );
    const subject = dto.subject ?? t.subject;
    const body = dto.body ?? t.body;
    const contentChanged = dto.subject !== undefined || dto.body !== undefined;
    if (contentChanged) this.assertValid(subject, body);
    // Launched campaigns keep their own content snapshot; editing never changes them.
    const u = await this.prisma.outreachTemplate.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.language ? { language: dto.language } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(contentChanged
          ? {
              subject: subject.trim(),
              body: body.trim(),
              variables: extractVariables(`${subject}\n${body}`),
              version: { increment: 1 },
            }
          : {}),
      },
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: dto.active === false ? 'template.archived' : 'template.updated',
      entityType: 'OutreachTemplate',
      entityId: id,
      metadata: { version: u.version },
    });
    return this.toTemplate(u, await this.names([u.createdByUserId]));
  }

  async duplicateTemplate(a: Actor, id: string) {
    const t = await this.visibleTemplate(a.organizationId, id);
    return this.createTemplate(a, {
      name: `${t.name} (copy)`.slice(0, 80),
      type: t.type,
      subject: t.subject,
      body: t.body,
      language: t.language,
    });
  }

  validate(subject: string, body: string): TemplateValidation {
    return validateTemplate(subject, body);
  }

  // ====================================================== AI generation

  private async companyFacts(organizationId: string) {
    const [{ companyName, website }, org, profile, certs, regs] =
      await Promise.all([
        this.branding(organizationId),
        this.prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: {
            city: true,
            state: true,
            country: true,
            businessType: true,
          },
        }),
        this.prisma.exporterProfile.findUnique({
          where: { organizationId },
          select: { exporterType: true },
        }),
        this.prisma.certification.findMany({
          where: { organizationId, status: 'ACTIVE' },
          select: { name: true },
        }),
        this.prisma.registration.findMany({
          where: { organizationId, status: 'AVAILABLE' },
          select: { type: true },
        }),
      ]);
    const facts = [`Exporter company: ${companyName}`];
    if (website) facts.push(`Company website: ${website}`);
    const type = profile?.exporterType ?? org.businessType;
    if (type)
      facts.push(`Business type: ${type.toLowerCase().replace(/_/g, ' ')}`);
    const loc = [org.city, org.state, org.country].filter(Boolean).join(', ');
    if (loc) facts.push(`Based in: ${loc}`);
    if (certs.length)
      facts.push(
        `Certifications declared by the exporter: ${certs.map((c) => c.name).join(', ')}`,
      );
    if (regs.length)
      facts.push(`Registrations held: ${regs.map((r) => r.type).join(', ')}`);
    return facts;
  }

  async generate(a: Actor, dto: GenerateDto): Promise<GeneratedContent> {
    const lang = OUTREACH_LANGUAGES.find((l) => l.code === dto.language);
    if (!lang) throw new BadRequestException('Unsupported language.');
    if (
      this.content.languages !== 'ANY' &&
      !this.content.languages.includes(dto.language)
    )
      throw new BadRequestException(
        'The development message generator supports English only. Choose English, use a template, or write the message manually.',
      );
    if (dto.countryCode && !isValidCountryCode(dto.countryCode))
      throw new BadRequestException('Unsupported country.');
    const facts = await this.companyFacts(a.organizationId);
    if (dto.productId) {
      const p = await this.prisma.organizationProduct.findFirst({
        where: { id: dto.productId, organizationId: a.organizationId },
        select: {
          displayName: true,
          hsCode: true,
          itcHsCode: true,
          description: true,
        },
      });
      if (!p) throw new NotFoundException('Product not found.');
      facts.push(`Product: ${p.displayName} (HS ${p.itcHsCode ?? p.hsCode})`);
      if (p.description)
        facts.push(
          `Product description (from exporter): ${p.description.slice(0, 300)}`,
        );
    }
    if (dto.countryCode)
      facts.push(`Target market: ${countryLabel(dto.countryCode)}`);
    let buyerSpecific = false;
    if (dto.buyerId) {
      const b = await this.prisma.buyerCompany.findFirst({
        where: {
          id: dto.buyerId,
          OR: [
            { ownerOrganizationId: null },
            { ownerOrganizationId: a.organizationId },
          ],
        },
        include: { activities: { select: { productName: true }, take: 5 } },
      });
      if (!b) throw new NotFoundException('Buyer not found.');
      if (b.isDemo) {
        // Sample buyer intelligence must never be presented to a real recipient as fact.
        facts.push('Buyer details are sample data and must not be referenced.');
      } else {
        buyerSpecific = true;
        facts.push(`Buyer type: ${b.buyerType.toLowerCase()}`);
        if (b.businessCategory)
          facts.push(
            `Buyer business category: ${b.businessCategory.toLowerCase().replace(/_/g, ' ')}`,
          );
        if (b.activities.length)
          facts.push(
            `Buyer known products: ${[...new Set(b.activities.map((x) => x.productName))].join(', ')}`,
          );
      }
    }
    let out: { subject: string; body: string };
    try {
      out = await this.content.generate({
        type: dto.type,
        tone: dto.tone,
        language: dto.language,
        languageLabel: lang.label,
        instructions: sanitizeText(dto.instructions, 500),
        facts,
        buyerSpecific,
      });
    } catch (e) {
      if (e instanceof ContentProviderError)
        throw new ServiceUnavailableException(
          `${e.message} You can still use a template or write the message manually.`,
        );
      throw e;
    }
    const v = validateTemplate(out.subject, out.body);
    const warnings = [
      ...unsupportedClaims(`${out.subject}\n${out.body}`, facts),
      ...(v.unknownVariables.length
        ? [
            `Generated text contains unknown placeholders (${v.unknownVariables.join(', ')}) — edit before saving.`,
          ]
        : []),
      ...(this.content.aiGenerated
        ? []
        : [
            'Development composer (not AI): a neutral draft assembled from your data.',
          ]),
    ];
    return {
      subject: out.subject,
      body: out.body,
      language: dto.language,
      provider: this.content.name,
      aiGenerated: this.content.aiGenerated,
      generatedAt: new Date().toISOString(),
      factsUsed: facts,
      warnings,
    };
  }

  // =========================================================== campaigns

  private async findCampaign(organizationId: string, id: string) {
    const c = await this.prisma.outreachCampaign.findFirst({
      where: { id, organizationId },
      include: { steps: { orderBy: { order: 'asc' } }, product: true },
    });
    if (!c) throw new NotFoundException('Campaign not found.');
    return c;
  }

  private assertDraft(c: { status: string }) {
    if (c.status !== 'DRAFT')
      throw new ConflictException(
        'This campaign has been launched; its content and recipients are locked.',
      );
  }

  async createCampaign(a: Actor, dto: CreateCampaignDto) {
    let productId = dto.productId ?? null;
    let countryCode = dto.countryCode ?? null;
    const buyerIds = [...(dto.buyerIds ?? [])];
    if (dto.leadId) {
      const lead = await this.prisma.buyerLead.findFirst({
        where: { id: dto.leadId, organizationId: a.organizationId },
      });
      if (!lead) throw new NotFoundException('Lead not found.');
      productId ??= lead.productId;
      countryCode ??= lead.countryCode;
      buyerIds.push(lead.buyerCompanyId);
    }
    if (productId) {
      const p = await this.prisma.organizationProduct.findFirst({
        where: { id: productId, organizationId: a.organizationId },
      });
      if (!p) throw new NotFoundException('Product not found.');
    }
    if (countryCode && !isValidCountryCode(countryCode))
      throw new BadRequestException('Unsupported country.');
    const s = await this.settingsRow(a.organizationId);
    const c = await this.prisma.outreachCampaign.create({
      data: {
        organizationId: a.organizationId,
        name:
          sanitizeText(dto.name, 120) ??
          `Campaign ${new Date().toISOString().slice(0, 10)}`,
        productId,
        countryCode,
        timezone: s.timezone,
        createdByUserId: a.userId,
        steps: { create: [{ order: 0, delayDays: 0, subject: '', body: '' }] },
      },
    });
    if (buyerIds.length) await this.setRecipients(a, c.id, buyerIds);
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'campaign.created',
      entityType: 'OutreachCampaign',
      entityId: c.id,
      metadata: { productId, countryCode, recipients: buyerIds.length },
    });
    return this.detail(a.organizationId, c.id);
  }

  async updateCampaign(a: Actor, id: string, dto: UpdateCampaignDto) {
    const c = await this.findCampaign(a.organizationId, id);
    this.assertDraft(c);
    if (dto.productId) {
      const p = await this.prisma.organizationProduct.findFirst({
        where: { id: dto.productId, organizationId: a.organizationId },
      });
      if (!p) throw new NotFoundException('Product not found.');
    }
    if (dto.countryCode && !isValidCountryCode(dto.countryCode))
      throw new BadRequestException('Unsupported country.');
    if (dto.timezone && !isValidTimezone(dto.timezone))
      throw new BadRequestException('Choose a valid timezone.');
    let templateVersion: number | undefined;
    if (dto.templateId)
      templateVersion = (
        await this.visibleTemplate(a.organizationId, dto.templateId)
      ).version;
    const s = await this.settingsRow(a.organizationId);
    if (dto.followUps && dto.followUps.length > s.maxFollowUps)
      throw new BadRequestException(
        `Your organization allows at most ${s.maxFollowUps} follow-up(s).`,
      );
    const data: Prisma.OutreachCampaignUpdateInput = {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.productId !== undefined
        ? {
            product: dto.productId
              ? { connect: { id: dto.productId } }
              : { disconnect: true },
          }
        : {}),
      ...(dto.countryCode !== undefined
        ? { countryCode: dto.countryCode }
        : {}),
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.body !== undefined ? { messageBody: dto.body } : {}),
      ...(dto.language ? { language: dto.language } : {}),
      ...(dto.templateId !== undefined
        ? {
            templateId: dto.templateId,
            templateVersion: templateVersion ?? null,
          }
        : {}),
      ...(dto.contentSource ? { contentSource: dto.contentSource } : {}),
      ...(dto.generationProvider !== undefined
        ? { generationProvider: dto.generationProvider }
        : {}),
      ...(dto.generatedAt !== undefined
        ? { generatedAt: dto.generatedAt ? new Date(dto.generatedAt) : null }
        : {}),
      ...(dto.sendMode ? { sendMode: dto.sendMode } : {}),
      ...(dto.scheduledAt !== undefined
        ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null }
        : {}),
      ...(dto.timezone ? { timezone: dto.timezone } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.outreachCampaign.update({ where: { id }, data });
      if (dto.subject !== undefined || dto.body !== undefined)
        await tx.campaignStep.update({
          where: { campaignId_order: { campaignId: id, order: 0 } },
          data: {
            ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
            ...(dto.body !== undefined ? { body: dto.body } : {}),
          },
        });
      if (dto.followUps) {
        await tx.campaignStep.deleteMany({
          where: { campaignId: id, order: { gt: 0 } },
        });
        if (dto.followUps.length)
          await tx.campaignStep.createMany({
            data: dto.followUps.map((f, i) => ({
              campaignId: id,
              order: i + 1,
              delayDays: f.delayDays,
              subject: f.subject,
              body: f.body,
            })),
          });
      }
    });
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'campaign.updated',
      entityType: 'OutreachCampaign',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return this.detail(a.organizationId, id);
  }

  // ---------------------------------------------------------- recipients

  /** Replaces the draft audience. Buyer IDs are de-duplicated; eligibility is computed, never silent. */
  async setRecipients(a: Actor, id: string, rawIds: string[]) {
    const c = await this.findCampaign(a.organizationId, id);
    this.assertDraft(c);
    const ids = [...new Set(rawIds)];
    const buyers = await this.prisma.buyerCompany.findMany({
      where: {
        id: { in: ids },
        OR: [
          { ownerOrganizationId: null },
          { ownerOrganizationId: a.organizationId },
        ],
      },
      select: { id: true },
    });
    if (buyers.length !== ids.length)
      throw new NotFoundException('One or more buyers were not found.');
    const leads = await this.prisma.buyerLead.findMany({
      where: { organizationId: a.organizationId, buyerCompanyId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    });
    const leadFor = (bid: string) =>
      leads.find(
        (l) => l.buyerCompanyId === bid && l.productId === c.productId,
      ) ??
      leads.find((l) => l.buyerCompanyId === bid) ??
      null;
    await this.prisma.$transaction(async (tx) => {
      await tx.campaignRecipient.deleteMany({
        where: { campaignId: id, buyerCompanyId: { notIn: ids } },
      });
      for (const bid of ids)
        await tx.campaignRecipient.upsert({
          where: {
            campaignId_buyerCompanyId: { campaignId: id, buyerCompanyId: bid },
          },
          create: {
            organizationId: a.organizationId,
            campaignId: id,
            buyerCompanyId: bid,
            crmLeadId: leadFor(bid)?.id ?? null,
            unsubscribeToken: randomBytes(24).toString('base64url'),
          },
          update: { crmLeadId: leadFor(bid)?.id ?? null },
        });
    });
    await this.resolveRecipients(
      a.organizationId,
      id,
      this.mode === 'PRODUCTION',
    );
    return this.recipients(a.organizationId, id, {});
  }

  /**
   * Computes eligibility for every recipient and snapshots address +
   * personalization. Order is stable (createdAt) so limits/duplicates are deterministic.
   */
  private async resolveRecipients(
    organizationId: string,
    campaignId: string,
    production: boolean,
  ) {
    const c = await this.findCampaign(organizationId, campaignId);
    const { s, companyName, website } = await this.branding(organizationId);
    const rows = await this.prisma.campaignRecipient.findMany({
      where: { campaignId },
      include: { buyerCompany: { include: { contacts: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const picks = rows.map((r) => ({
      r,
      ...pickEmailContact(r.buyerCompany.contacts, r.contactId),
    }));
    const addrs = picks
      .map((p) => (p.contact ? normalizeAddress(p.contact.value) : null))
      .filter((x): x is string => Boolean(x));
    const [suppressions, recent] = await Promise.all([
      this.prisma.outreachSuppression.findMany({
        where: { organizationId, address: { in: addrs } },
      }),
      this.prisma.outreachMessage.findMany({
        where: {
          organizationId,
          testSend: false,
          toAddress: { in: addrs },
          campaignId: { not: campaignId },
          OR: [
            {
              sentAt: {
                gte: new Date(Date.now() - s.contactCooldownDays * DAY_MS),
              },
            },
            { status: { in: ['SCHEDULED', 'QUEUED'] } },
          ],
        },
        select: { toAddress: true },
      }),
    ]);
    const supMap = new Map(suppressions.map((x) => [x.address, x.reason]));
    const cooldown = new Set(recent.map((m) => m.toAddress));
    const seen = new Set<string>();
    let eligible = 0;
    for (const { r, contact, reason } of picks) {
      const address = contact ? normalizeAddress(contact.value) : null;
      const duplicate = Boolean(address && seen.has(address));
      if (address) seen.add(address);
      let excluded = exclusionReason({
        address,
        contactReason: reason,
        isDemo: r.buyerCompany.isDemo,
        production,
        suppression: address ? (supMap.get(address) ?? null) : null,
        duplicate,
        inCooldown: Boolean(address && cooldown.has(address)),
        overCampaignLimit: eligible >= s.maxRecipientsPerCampaign,
      });
      const values: VariableValues = {
        buyerCompany: r.buyerCompany.canonicalName,
        contactName: contact?.name ?? null,
        productName: c.product?.displayName ?? null,
        hsCode: c.product ? (c.product.itcHsCode ?? c.product.hsCode) : null,
        country: c.countryCode
          ? countryLabel(c.countryCode)
          : countryLabel(r.buyerCompany.countryCode),
        senderName: s.fromName,
        companyName,
        website,
      };
      if (!excluded && (c.subject || c.messageBody)) {
        const out = render(c.subject, c.messageBody, {
          ...values,
          unsubscribeLink: 'x',
        });
        // Campaign-wide gaps (sender/product) are launch errors; only buyer-specific gaps exclude a recipient.
        if (out.unresolved.some((v) => v === 'buyerCompany'))
          excluded = 'UNRESOLVED_VARIABLE';
      }
      const warnings: string[] = [];
      const lvl = riskLevel(r.buyerCompany.riskScore);
      if (lvl === 'HIGH' || lvl === 'VERY_HIGH')
        warnings.push('Buyer requires additional verification.');
      if (contact && contact.verificationStatus !== 'VERIFIED')
        warnings.push(
          'Email format checked only — deliverability is not verified.',
        );
      if (r.buyerCompany.isDemo)
        warnings.push('Sample/demo buyer — development delivery only.');
      if (!excluded) eligible++;
      await this.prisma.campaignRecipient.update({
        where: { id: r.id },
        data: {
          contactId: contact?.id ?? null,
          address,
          contactName: contact?.name ?? null,
          personalization: values as Prisma.InputJsonValue,
          isDemo: r.buyerCompany.isDemo,
          excludedReason: excluded,
          warnings,
          status: excluded ? 'EXCLUDED' : 'PENDING',
        },
      });
    }
    return eligible;
  }

  async recipients(
    organizationId: string,
    id: string,
    q: { status?: string; page?: number; pageSize?: number },
  ): Promise<RecipientListResponse> {
    await this.findCampaign(organizationId, id);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.CampaignRecipientWhereInput = {
      campaignId: id,
      ...(q.status ? { status: q.status as never } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.campaignRecipient.count({ where }),
      this.prisma.campaignRecipient.findMany({
        where,
        include: {
          buyerCompany: {
            select: {
              id: true,
              canonicalName: true,
              countryCode: true,
              isDemo: true,
              verificationStatus: true,
              riskScore: true,
              contacts: {
                select: {
                  id: true,
                  verificationStatus: true,
                  confidence: true,
                },
              },
            },
          },
          messages: {
            where: { testSend: false },
            orderBy: { stepOrder: 'asc' },
            include: {
              events: { where: { type: 'REPLIED' }, select: { source: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const leads = await this.prisma.buyerLead.findMany({
      where: {
        organizationId,
        id: {
          in: rows
            .map((r) => r.crmLeadId)
            .filter((x): x is string => Boolean(x)),
        },
      },
      select: { id: true, stage: true },
    });
    const items: RecipientView[] = rows.map((r) => {
      const msgs = r.messages;
      const last = msgs[msgs.length - 1];
      const first = <
        K extends
          'sentAt' | 'deliveredAt' | 'openedAt' | 'repliedAt' | 'bouncedAt',
      >(
        k: K,
      ) =>
        msgs
          .map((m) => m[k])
          .find((d): d is Date => Boolean(d))
          ?.toISOString() ?? null;
      const contact = r.buyerCompany.contacts.find((x) => x.id === r.contactId);
      const lead = leads.find((l) => l.id === r.crmLeadId);
      return {
        id: r.id,
        buyer: {
          id: r.buyerCompany.id,
          name: r.buyerCompany.canonicalName,
          countryCode: r.buyerCompany.countryCode,
          demo: r.buyerCompany.isDemo,
          verificationStatus: r.buyerCompany.verificationStatus,
          risk: {
            score: r.buyerCompany.riskScore,
            level: riskLevel(r.buyerCompany.riskScore),
          },
        },
        contact: r.address
          ? {
              id: r.contactId ?? '',
              name: r.contactName,
              address: r.address,
              verificationStatus: contact?.verificationStatus ?? 'UNVERIFIED',
              confidence: contact?.confidence ?? 0,
            }
          : null,
        crmLead: lead ? { id: lead.id, stage: lead.stage } : null,
        status: r.status,
        excludedReason: r.excludedReason,
        warnings: r.warnings,
        interested: r.interested,
        lastMessage: last
          ? {
              status: last.status,
              stepOrder: last.stepOrder,
              sentAt: last.sentAt?.toISOString() ?? null,
              simulated: last.simulated,
            }
          : null,
        sentAt: first('sentAt'),
        deliveredAt: first('deliveredAt'),
        openedAt: first('openedAt'),
        repliedAt: first('repliedAt'),
        bouncedAt: first('bouncedAt'),
        replySource:
          msgs.flatMap((m) => m.events).map((e) => e.source)[0] ?? null,
        nextFollowUpAt:
          msgs
            .find((m) => m.status === 'SCHEDULED' && m.stepOrder > 0)
            ?.scheduledAt?.toISOString() ?? null,
      };
    });
    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  // ------------------------------------------------------------- preview

  async preview(
    organizationId: string,
    id: string,
    draft: { subject?: string; body?: string },
  ): Promise<RenderedPreview[]> {
    const c = await this.findCampaign(organizationId, id);
    const subject = draft.subject ?? c.subject;
    const body = draft.body ?? c.messageBody;
    const v = validateTemplate(subject, body);
    if (v.unknownVariables.length)
      throw new BadRequestException(v.errors.join(' '));
    const rows = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      include: { buyerCompany: { select: { canonicalName: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: PREVIEW_COUNT,
    });
    const { s, companyName, website } = await this.branding(organizationId);
    const base: VariableValues = {
      productName: c.product?.displayName ?? null,
      hsCode: c.product ? (c.product.itcHsCode ?? c.product.hsCode) : null,
      country: c.countryCode ? countryLabel(c.countryCode) : null,
      senderName: s.fromName,
      companyName,
      website,
    };
    const unsub = `${this.config.get('app.frontendUrl', { infer: true })}/unsubscribe/…`;
    const one = (
      buyerName: string,
      values: VariableValues,
      rid: string | null,
      to: string | null,
    ): RenderedPreview => {
      const out = render(subject, body, {
        ...base,
        ...values,
        unsubscribeLink: unsub,
      });
      return {
        recipientId: rid,
        buyerName,
        toAddress: to,
        subject: out.subject,
        body: withFooter(out.body, s.signature, unsub),
        unresolved: out.unresolved,
      };
    };
    if (!rows.length)
      return [
        one(
          'Sample Buyer Co.',
          { buyerCompany: 'Sample Buyer Co.', contactName: null },
          null,
          null,
        ),
      ];
    return rows.map((r) =>
      one(
        r.buyerCompany.canonicalName,
        {
          ...((r.personalization ?? {}) as VariableValues),
          ...base,
          buyerCompany: r.buyerCompany.canonicalName,
          contactName: r.contactName,
          country:
            base.country ??
            (r.personalization as VariableValues | null)?.country ??
            null,
        },
        r.id,
        r.address,
      ),
    );
  }

  // -------------------------------------------------------------- launch

  async launchCheck(a: Actor, id: string): Promise<LaunchCheck> {
    const c = await this.findCampaign(a.organizationId, id);
    const production = this.mode === 'PRODUCTION';
    const errors: string[] = [];
    const warnings: string[] = [];
    if (c.status === 'DRAFT')
      await this.resolveRecipients(a.organizationId, id, production);
    else errors.push('This campaign has already been launched.');
    const { s, companyName, website } = await this.branding(a.organizationId);
    if (!s.enabled) errors.push('Outreach is disabled in Outreach settings.');
    if (!s.fromName || !s.fromEmail)
      errors.push('Set a sender name and sender email in Outreach settings.');
    if (production) {
      if (!this.provider.configured)
        errors.push('Email sending is not configured.');
      else if (s.domainStatus !== 'VERIFIED')
        errors.push(
          'The sender domain is not verified with the email provider. Verify it in Outreach settings.',
        );
    } else
      warnings.push(
        'Development delivery: messages are recorded locally and NOT sent to any buyer.',
      );
    const steps = c.steps.filter((x) => x.active);
    for (const step of steps) {
      const label =
        step.order === 0 ? 'Initial message' : `Follow-up ${step.order}`;
      const v = validateTemplate(step.subject, step.body);
      if (!v.valid) errors.push(`${label}: ${v.errors.join(' ')}`);
      const out = render(step.subject, step.body, {
        buyerCompany: 'x',
        contactName: 'x',
        country: 'x',
        unsubscribeLink: 'x',
        productName: c.product?.displayName ?? null,
        hsCode: c.product ? (c.product.itcHsCode ?? c.product.hsCode) : null,
        senderName: s.fromName,
        companyName,
        website,
      });
      if (out.unresolved.length)
        errors.push(
          `${label}: no value for ${out.unresolved.map((u) => `{{${u}}}`).join(', ')} (set the product / sender details or remove the variable).`,
        );
    }
    if (c.steps.length - 1 > s.maxFollowUps)
      errors.push(`At most ${s.maxFollowUps} follow-up(s) are allowed.`);
    if (c.sendMode === 'SCHEDULED') {
      if (!c.scheduledAt) errors.push('Choose a send date and time.');
      else if (c.scheduledAt.getTime() < Date.now() - 60_000)
        errors.push('The scheduled time is in the past.');
      else if (
        c.scheduledAt.getTime() >
        Date.now() + MAX_SCHEDULE_DAYS * DAY_MS
      )
        errors.push(`Schedule within the next ${MAX_SCHEDULE_DAYS} days.`);
    }
    const rows = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      select: { status: true, excludedReason: true, warnings: true },
    });
    const eligible = rows.filter((r) => r.status === 'PENDING').length;
    if (!rows.length) errors.push('Add at least one buyer.');
    else if (!eligible)
      errors.push('No eligible recipients — see the excluded reasons.');
    const excludedMap = new Map<ExclusionReason, number>();
    for (const r of rows)
      if (r.excludedReason)
        excludedMap.set(
          r.excludedReason,
          (excludedMap.get(r.excludedReason) ?? 0) + 1,
        );
    if (
      rows.some((r) =>
        r.warnings.includes('Buyer requires additional verification.'),
      )
    )
      warnings.push(
        'Some buyers require additional verification (high buyer risk). They are not excluded — review before launching.',
      );
    const sentToday = await this.prisma.outreachMessage.count({
      where: {
        organizationId: a.organizationId,
        testSend: false,
        sentAt: { gte: startOfUtcDay(new Date()) },
      },
    });
    const dailyRemaining = Math.max(0, s.dailyLimit - sentToday);
    if (eligible > dailyRemaining)
      warnings.push(
        `Daily limit: ${dailyRemaining} message(s) left today; the rest will be sent on following days.`,
      );
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      deliveryMode: this.mode,
      provider: this.providerStatus(),
      recipients: rows.length,
      eligible,
      excluded: [...excludedMap].map(([reason, count]) => ({ reason, count })),
      estimatedMessages: eligible * steps.length,
      dailyRemaining,
      sender: {
        fromName: s.fromName,
        fromEmail: s.fromEmail,
        replyTo: s.replyTo,
      },
    };
  }

  /**
   * Idempotent launch: the DRAFT→SCHEDULED/RUNNING transition is atomic and
   * messages use unique `recipientId:step` keys, so repeated requests never
   * create duplicate initial sends.
   */
  async launch(a: Actor, id: string, confirm: boolean) {
    if (!confirm)
      throw new BadRequestException(
        'Confirm that you reviewed the message and recipients.',
      );
    const existing = await this.findCampaign(a.organizationId, id);
    if (existing.status !== 'DRAFT')
      return {
        campaign: await this.detail(a.organizationId, id),
        alreadyLaunched: true,
      };
    const recentLaunches = await this.prisma.outreachCampaign.count({
      where: {
        organizationId: a.organizationId,
        launchedAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recentLaunches >= MAX_LAUNCHES_PER_HOUR)
      throw new BadRequestException(
        'Too many campaigns launched in the last hour. Please wait before launching another.',
      );
    const check = await this.launchCheck(a, id);
    if (!check.ok)
      throw new BadRequestException({
        message: check.errors.join(' '),
        details: check,
      });
    const c = await this.findCampaign(a.organizationId, id);
    const { s, companyName, website } = await this.branding(a.organizationId);
    const now = new Date();
    const startAt =
      c.sendMode === 'SCHEDULED' && c.scheduledAt ? c.scheduledAt : now;
    const step0 = c.steps.find((x) => x.order === 0)!;
    const frontend = this.config.get('app.frontendUrl', { infer: true });
    const recips = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: id, status: 'PENDING' },
    });
    const launched = await this.prisma.$transaction(async (tx) => {
      const r = await tx.outreachCampaign.updateMany({
        where: { id, organizationId: a.organizationId, status: 'DRAFT' },
        data: {
          status: c.sendMode === 'SCHEDULED' ? 'SCHEDULED' : 'RUNNING',
          deliveryMode: this.mode,
          provider: this.provider.name,
          fromName: s.fromName,
          fromEmail: s.fromEmail,
          replyTo: s.replyTo,
          signature: s.signature,
          companyName,
          companyWebsite: website,
          launchedAt: now,
          launchedByUserId: a.userId,
          audienceCount: recips.length,
        },
      });
      if (r.count === 0) return false;
      for (const rec of recips) {
        const unsub = `${frontend}/unsubscribe/${rec.unsubscribeToken}`;
        const values = {
          ...((rec.personalization ?? {}) as VariableValues),
          senderName: s.fromName,
          companyName,
          website,
        };
        const out = render(step0.subject, step0.body, {
          ...values,
          unsubscribeLink: unsub,
        });
        if (out.unresolved.length) {
          await tx.campaignRecipient.update({
            where: { id: rec.id },
            data: { status: 'EXCLUDED', excludedReason: 'UNRESOLVED_VARIABLE' },
          });
          continue;
        }
        await tx.campaignRecipient.update({
          where: { id: rec.id },
          data: {
            status: 'ACTIVE',
            personalization: values as Prisma.InputJsonValue,
          },
        });
        await tx.outreachMessage.createMany({
          data: [
            {
              organizationId: a.organizationId,
              campaignId: id,
              recipientId: rec.id,
              buyerCompanyId: rec.buyerCompanyId,
              crmLeadId: rec.crmLeadId,
              stepOrder: 0,
              idempotencyKey: `${rec.id}:0`,
              toAddress: rec.address!,
              fromAddress: s.fromEmail,
              subject: out.subject,
              body: withFooter(out.body, s.signature, unsub),
              provider: this.provider.name,
              status: 'SCHEDULED',
              scheduledAt: startAt,
            },
          ],
          skipDuplicates: true,
        });
      }
      return true;
    });
    if (!launched)
      return {
        campaign: await this.detail(a.organizationId, id),
        alreadyLaunched: true,
      };
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'campaign.launched',
      entityType: 'OutreachCampaign',
      entityId: id,
      metadata: {
        deliveryMode: this.mode,
        provider: this.provider.name,
        recipients: recips.length,
        sendMode: c.sendMode,
        scheduledAt: startAt.toISOString(),
      },
    });
    if (c.sendMode === 'NOW') this.processor.kick();
    return {
      campaign: await this.detail(a.organizationId, id),
      alreadyLaunched: false,
    };
  }

  async pause(a: Actor, id: string) {
    return this.transition(
      a,
      id,
      ['SCHEDULED', 'RUNNING'],
      'PAUSED',
      'campaign.paused',
      { pausedAt: new Date() },
    );
  }

  async resume(a: Actor, id: string) {
    const c = await this.findCampaign(a.organizationId, id);
    const anySent = await this.prisma.outreachMessage.count({
      where: { campaignId: id, sentAt: { not: null } },
    });
    const r = await this.transition(
      a,
      id,
      ['PAUSED'],
      anySent || (c.scheduledAt ?? new Date()) <= new Date()
        ? 'RUNNING'
        : 'SCHEDULED',
      'campaign.resumed',
      { pausedAt: null },
    );
    this.processor.kick();
    return r;
  }

  async cancel(a: Actor, id: string) {
    const r = await this.transition(
      a,
      id,
      ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED'],
      'CANCELLED',
      'campaign.cancelled',
      { cancelledAt: new Date() },
    );
    // Sent messages stay as history; every unsent one is cancelled.
    await this.prisma.outreachMessage.updateMany({
      where: {
        campaignId: id,
        status: { in: ['SCHEDULED', 'QUEUED', 'DRAFT'] },
      },
      data: { status: 'CANCELLED', lockedAt: null },
    });
    await this.prisma.campaignRecipient.updateMany({
      where: { campaignId: id, status: { in: ['ACTIVE', 'PENDING'] } },
      data: { status: 'CANCELLED' },
    });
    return r;
  }

  private async transition(
    a: Actor,
    id: string,
    from: string[],
    to: 'PAUSED' | 'RUNNING' | 'SCHEDULED' | 'CANCELLED',
    action: string,
    extra: Prisma.OutreachCampaignUpdateManyMutationInput,
  ) {
    const c = await this.findCampaign(a.organizationId, id);
    const r = await this.prisma.outreachCampaign.updateMany({
      where: {
        id,
        organizationId: a.organizationId,
        status: { in: from as never },
      },
      data: { status: to, ...extra },
    });
    if (r.count === 0)
      throw new ConflictException(
        `A ${c.status.toLowerCase()} campaign cannot be ${action.split('.')[1]}.`,
      );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action,
      entityType: 'OutreachCampaign',
      entityId: id,
      metadata: { from: c.status, to },
    });
    return this.detail(a.organizationId, id);
  }

  // ----------------------------------------------------------- test send

  async testSend(a: Actor, id: string) {
    const c = await this.findCampaign(a.organizationId, id);
    if (!this.provider.capabilities.testSend)
      throw new BadRequestException(
        'Test send is not available: email sending is not configured.',
      );
    const since = new Date(Date.now() - 3_600_000);
    if (
      (await this.prisma.outreachMessage.count({
        where: {
          organizationId: a.organizationId,
          testSend: true,
          createdAt: { gte: since },
        },
      })) >= MAX_TESTS_PER_HOUR
    )
      throw new BadRequestException(
        'Test-send limit reached. Try again later.',
      );
    const [preview] = await this.preview(a.organizationId, id, {});
    if (preview.unresolved.length)
      throw new BadRequestException(
        `Resolve ${preview.unresolved.map((u) => `{{${u}}}`).join(', ')} before a test send.`,
      );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: a.userId },
      select: { email: true },
    });
    const { s } = await this.branding(a.organizationId);
    if (this.mode === 'PRODUCTION' && (!s.fromEmail || !s.fromName))
      throw new BadRequestException('Set a sender name and email first.');
    const subject = `[TEST] ${preview.subject}`;
    const msg = await this.prisma.outreachMessage.create({
      data: {
        organizationId: a.organizationId,
        campaignId: c.id,
        idempotencyKey: `test:${randomUUID()}`,
        toAddress: user.email,
        fromAddress: s.fromEmail,
        subject,
        body: preview.body,
        provider: this.provider.name,
        testSend: true,
        status: 'QUEUED',
      },
    });
    try {
      const res = await this.provider.send({
        channel: 'EMAIL',
        idempotencyKey: msg.idempotencyKey,
        to: user.email,
        fromName: s.fromName ?? 'ExportPro test',
        fromEmail: s.fromEmail ?? 'no-reply@example.invalid',
        replyTo: s.replyTo,
        subject,
        text: preview.body,
        html: textToHtml(preview.body),
        unsubscribeUrl: null,
        testSend: true,
      });
      await this.prisma.outreachMessage.update({
        where: { id: msg.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          simulated: res.simulated,
          providerMessageId: res.providerMessageId,
        },
      });
      return {
        sentTo: user.email,
        simulated: res.simulated,
        message: res.simulated
          ? 'Development provider: the test message was recorded but NOT delivered to any inbox.'
          : `Test email sent to ${user.email}.`,
      };
    } catch (e) {
      await this.prisma.outreachMessage.update({
        where: { id: msg.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          lastError: (e as Error).message,
        },
      });
      throw new ServiceUnavailableException(
        'Test send failed at the email provider.',
      );
    }
  }

  // ----------------------------------------------------------- analytics

  private async countsFor(
    campaigns: {
      id: string;
      deliveryMode: DeliveryMode | null;
      provider: string | null;
    }[],
  ) {
    const ids = campaigns.map((c) => c.id);
    const recips = ids.length
      ? await this.prisma.campaignRecipient.findMany({
          where: { campaignId: { in: ids } },
          select: {
            campaignId: true,
            status: true,
            interested: true,
            crmLeadId: true,
            messages: {
              where: { testSend: false },
              select: {
                status: true,
                sentAt: true,
                deliveredAt: true,
                openedAt: true,
                repliedAt: true,
                bouncedAt: true,
                events: {
                  where: { type: 'REPLIED' },
                  select: { source: true },
                },
              },
            },
          },
        })
      : [];
    const leads = await this.prisma.buyerLead.findMany({
      where: {
        id: {
          in: recips
            .map((r) => r.crmLeadId)
            .filter((x): x is string => Boolean(x)),
        },
      },
      select: { id: true, stage: true },
    });
    const stage = new Map(leads.map((l) => [l.id, l.stage]));
    const out = new Map<string, CampaignCounts>();
    for (const c of campaigns) {
      const caps = this.capsFor(c);
      const rs = recips.filter((r) => r.campaignId === c.id);
      const has = (
        r: (typeof rs)[number],
        k: 'sentAt' | 'deliveredAt' | 'openedAt' | 'repliedAt' | 'bouncedAt',
      ) => r.messages.some((m) => m[k]);
      const replied = rs.filter(
        (r) => r.status === 'REPLIED' || has(r, 'repliedAt'),
      );
      out.set(c.id, {
        recipients: rs.length,
        eligible: rs.filter((r) => r.status !== 'EXCLUDED').length,
        excluded: rs.filter((r) => r.status === 'EXCLUDED').length,
        queued: rs.filter((r) =>
          r.messages.some(
            (m) => m.status === 'SCHEDULED' || m.status === 'QUEUED',
          ),
        ).length,
        sent: rs.filter((r) => has(r, 'sentAt')).length,
        delivered: caps.delivered
          ? rs.filter((r) => has(r, 'deliveredAt')).length
          : null,
        opened: caps.opened
          ? rs.filter((r) => has(r, 'openedAt')).length
          : null,
        replied: replied.length,
        repliedManual: replied.filter((r) =>
          r.messages.some((m) => m.events.some((e) => e.source === 'MANUAL')),
        ).length,
        bounced: rs.filter((r) => has(r, 'bouncedAt')).length,
        optedOut: rs.filter((r) => r.status === 'OPTED_OUT' && has(r, 'sentAt'))
          .length,
        failed: rs.filter((r) => r.status === 'FAILED').length,
        // Only contacted recipients can count as interested/converted.
        interested: rs.filter(
          (r) =>
            has(r, 'sentAt') &&
            (r.interested ||
              stageAtLeast(
                r.crmLeadId ? stage.get(r.crmLeadId) : undefined,
                INTERESTED_FROM,
              )),
        ).length,
        converted: rs.filter(
          (r) =>
            has(r, 'sentAt') &&
            stageAtLeast(
              r.crmLeadId ? stage.get(r.crmLeadId) : undefined,
              CONVERTED_FROM,
            ),
        ).length,
      });
    }
    return out;
  }

  private analytics(
    c: { deliveryMode: DeliveryMode | null; provider: string | null },
    k: CampaignCounts,
  ): CampaignAnalytics {
    const caps = this.capsFor(c);
    return {
      ...k,
      deliveryMode: c.deliveryMode ?? this.mode,
      capabilities: caps,
      deliveryRate: caps.delivered ? rate(k.delivered, k.sent) : null,
      openRate: caps.opened ? rate(k.opened, k.delivered) : null,
      replyRate: rate(k.replied, k.sent),
      methodology: METHODOLOGY,
    };
  }

  async list(
    organizationId: string,
    q: CampaignListQueryDto,
  ): Promise<CampaignListResponse> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.OutreachCampaignWhereInput = {
      organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.outreachCampaign.count({ where }),
      this.prisma.outreachCampaign.findMany({
        where,
        include: { product: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const [counts, names] = await Promise.all([
      this.countsFor(rows),
      this.names(rows.map((r) => r.createdByUserId)),
    ]);
    return {
      items: rows.map((r) => this.summary(r, counts.get(r.id)!, names)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  private summary(
    c: Prisma.OutreachCampaignGetPayload<object> & {
      product: { id: string; displayName: string } | null;
    },
    counts: CampaignCounts,
    names: Map<string, string>,
  ): CampaignSummary {
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      channel: c.channel,
      deliveryMode: c.deliveryMode,
      product: c.product
        ? { id: c.product.id, name: c.product.displayName }
        : null,
      countryCode: c.countryCode,
      scheduledAt:
        (c.sendMode === 'SCHEDULED'
          ? c.scheduledAt
          : c.launchedAt
        )?.toISOString() ?? null,
      timezone: c.timezone,
      launchedAt: c.launchedAt?.toISOString() ?? null,
      createdBy: names.get(c.createdByUserId) ?? null,
      createdAt: c.createdAt.toISOString(),
      counts,
    };
  }

  async detail(organizationId: string, id: string): Promise<CampaignDetail> {
    const c = await this.findCampaign(organizationId, id);
    const [counts, names] = await Promise.all([
      this.countsFor([c]),
      this.names([c.createdByUserId, c.launchedByUserId]),
    ]);
    const k = counts.get(c.id)!;
    const s =
      c.status === 'DRAFT' ? await this.settingsRow(organizationId) : null;
    return {
      ...this.summary(c, k, names),
      subject: c.subject,
      body: c.messageBody,
      language: c.language,
      templateId: c.templateId,
      templateVersion: c.templateVersion,
      contentSource: c.contentSource,
      generationProvider: c.generationProvider,
      generatedAt: c.generatedAt?.toISOString() ?? null,
      steps: c.steps.map((x) => ({
        order: x.order,
        delayDays: x.delayDays,
        subject: x.subject,
        body: x.body,
        active: x.active,
      })),
      sendMode: c.sendMode === 'SCHEDULED' ? 'SCHEDULED' : 'NOW',
      completedAt: c.completedAt?.toISOString() ?? null,
      launchedBy: c.launchedByUserId
        ? (names.get(c.launchedByUserId) ?? null)
        : null,
      analytics: this.analytics(c, k),
      sender: s
        ? { fromName: s.fromName, fromEmail: s.fromEmail, replyTo: s.replyTo }
        : { fromName: c.fromName, fromEmail: c.fromEmail, replyTo: c.replyTo },
      locked: c.status !== 'DRAFT',
    };
  }

  // ------------------------------------------------------ messages/history

  private toMessage(
    m: Prisma.OutreachMessageGetPayload<{
      include: { campaign: { select: { id: true; name: true } } };
    }>,
    buyers: Map<string, string>,
  ): OutreachMessageView {
    return {
      id: m.id,
      campaign: m.campaign
        ? { id: m.campaign.id, name: m.campaign.name }
        : null,
      buyer: m.buyerCompanyId
        ? {
            id: m.buyerCompanyId,
            name: buyers.get(m.buyerCompanyId) ?? 'Buyer',
          }
        : null,
      crmLeadId: m.crmLeadId,
      recipientId: m.recipientId,
      channel: m.channel,
      direction: m.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
      toAddress: m.toAddress,
      subject: m.subject,
      stepOrder: m.stepOrder,
      provider: m.provider,
      simulated: m.simulated,
      testSend: m.testSend,
      status: m.status,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      sentAt: m.sentAt?.toISOString() ?? null,
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
      openedAt: m.openedAt?.toISOString() ?? null,
      repliedAt: m.repliedAt?.toISOString() ?? null,
      bouncedAt: m.bouncedAt?.toISOString() ?? null,
      failedAt: m.failedAt?.toISOString() ?? null,
      lastError: m.lastError,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async buyerNames(ids: (string | null)[]) {
    const u = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const rows = u.length
      ? await this.prisma.buyerCompany.findMany({
          where: { id: { in: u } },
          select: { id: true, canonicalName: true },
        })
      : [];
    return new Map(rows.map((r) => [r.id, r.canonicalName]));
  }

  async messages(
    organizationId: string,
    q: MessageQueryDto,
  ): Promise<MessageListResponse> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const term = q.q?.trim();
    const where: Prisma.OutreachMessageWhereInput = {
      organizationId,
      testSend: false,
      ...(q.campaignId ? { campaignId: q.campaignId } : {}),
      ...(q.buyerId ? { buyerCompanyId: q.buyerId } : {}),
      ...(q.leadId ? { crmLeadId: q.leadId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel as never } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(term
        ? {
            OR: [
              { subject: { contains: term, mode: 'insensitive' } },
              { toAddress: { contains: term, mode: 'insensitive' } },
              { campaign: { name: { contains: term, mode: 'insensitive' } } },
              {
                recipient: {
                  buyerCompany: {
                    canonicalName: { contains: term, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.outreachMessage.count({ where }),
      this.prisma.outreachMessage.findMany({
        where,
        include: { campaign: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const buyers = await this.buyerNames(rows.map((r) => r.buyerCompanyId));
    return {
      items: rows.map((r) => this.toMessage(r, buyers)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async message(
    organizationId: string,
    id: string,
  ): Promise<OutreachMessageDetail> {
    const m = await this.prisma.outreachMessage.findFirst({
      where: { id, organizationId },
      include: {
        campaign: { select: { id: true, name: true } },
        events: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!m) throw new NotFoundException('Message not found.');
    const buyers = await this.buyerNames([m.buyerCompanyId]);
    return {
      ...this.toMessage(m, buyers),
      body: m.body,
      events: m.events.map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  async buyerHistory(
    organizationId: string,
    buyerId: string,
  ): Promise<BuyerOutreachHistory> {
    const b = await this.prisma.buyerCompany.findFirst({
      where: {
        id: buyerId,
        OR: [
          { ownerOrganizationId: null },
          { ownerOrganizationId: organizationId },
        ],
      },
      include: {
        contacts: { where: { contactType: 'EMAIL' }, select: { value: true } },
      },
    });
    if (!b) throw new NotFoundException('Buyer not found.');
    const { items } = await this.messages(organizationId, {
      buyerId,
      pageSize: 10,
    });
    const suppressed = b.contacts.length
      ? (await this.prisma.outreachSuppression.count({
          where: {
            organizationId,
            address: { in: b.contacts.map((c) => normalizeAddress(c.value)) },
          },
        })) > 0
      : false;
    return { latest: items[0] ?? null, messages: items, suppressed };
  }

  // ---------------------------------------------------- manual signals

  private async findRecipient(organizationId: string, id: string) {
    const r = await this.prisma.campaignRecipient.findFirst({
      where: { id, organizationId },
      include: { campaign: true },
    });
    if (!r) throw new NotFoundException('Recipient not found.');
    return r;
  }

  /**
   * Manual reply recording (the provider has no inbound reply signal).
   * Stops all follow-ups immediately and is labelled MANUAL everywhere.
   */
  async markReplied(a: Actor, recipientId: string, replyText?: string) {
    const r = await this.findRecipient(a.organizationId, recipientId);
    const m = await this.prisma.outreachMessage.findFirst({
      where: { recipientId, testSend: false, sentAt: { not: null } },
      orderBy: { stepOrder: 'desc' },
    });
    if (!m)
      throw new BadRequestException(
        'No message has been sent to this recipient yet.',
      );
    if (r.status === 'REPLIED')
      return this.recipientView(a.organizationId, r.campaignId, recipientId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.outreachMessage.update({
        where: { id: m.id },
        data: { status: 'REPLIED', repliedAt: now },
      });
      await this.events.event(tx, m, 'REPLIED', 'MANUAL', {
        metadata: { markedBy: a.userId },
      });
      await this.events.stopRecipient(tx, recipientId, 'REPLIED');
      await this.events.crmActivity(tx, {
        organizationId: a.organizationId,
        leadId: r.crmLeadId,
        direction: 'INBOUND',
        title: `Reply recorded manually — campaign: ${r.campaign.name}`,
        occurredAt: now,
        metadata: { campaignId: r.campaignId, messageId: m.id, manual: true },
        touchLastActivity: true,
        actorUserId: a.userId,
      });
    });
    // Sprint 13: the reply becomes a NEW, unread inquiry (idempotent per message, never auto-qualified).
    await this.intake.fromOutreachReply(
      a.organizationId,
      m.id,
      a.userId,
      replyText,
    );
    return this.recipientView(a.organizationId, r.campaignId, recipientId);
  }

  async markInterested(a: Actor, recipientId: string, interested: boolean) {
    const r = await this.findRecipient(a.organizationId, recipientId);
    await this.prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { interested, interestedAt: interested ? new Date() : null },
    });
    return this.recipientView(a.organizationId, r.campaignId, recipientId);
  }

  async cancelRecipient(a: Actor, recipientId: string) {
    const r = await this.findRecipient(a.organizationId, recipientId);
    await this.events.stopRecipient(this.prisma, recipientId, 'CANCELLED');
    return this.recipientView(a.organizationId, r.campaignId, recipientId);
  }

  private async recipientView(
    organizationId: string,
    campaignId: string,
    recipientId: string,
  ) {
    const all = await this.recipients(organizationId, campaignId, {
      pageSize: 100,
    });
    return all.items.find((i) => i.id === recipientId)!;
  }

  // -------------------------------------------------------- suppression

  async suppressions(organizationId: string): Promise<SuppressionView[]> {
    const rows = await this.prisma.outreachSuppression.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const buyers = await this.buyerNames(rows.map((r) => r.buyerCompanyId));
    return rows.map((r) => ({
      id: r.id,
      address: r.address,
      reason: r.reason,
      source: r.source,
      buyer: r.buyerCompanyId
        ? {
            id: r.buyerCompanyId,
            name: buyers.get(r.buyerCompanyId) ?? 'Buyer',
          }
        : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addSuppression(a: Actor, address: string) {
    await this.events.suppress(
      this.prisma,
      a.organizationId,
      address,
      'MANUAL_BLOCK',
      `user:${a.userId}`,
    );
    await this.audit.record({
      organizationId: a.organizationId,
      actorId: a.userId,
      action: 'outreach.suppression_added',
      entityType: 'OutreachSuppression',
      entityId: normalizeAddress(address),
      metadata: { reason: 'MANUAL_BLOCK' },
    });
    return this.suppressions(a.organizationId);
  }

  // --------------------------------------------------------- unsubscribe

  /** Public: reveals nothing about the organization or contact. */
  async unsubscribeStatus(token: string) {
    const r = await this.prisma.campaignRecipient.findUnique({
      where: { unsubscribeToken: token },
      select: { organizationId: true, address: true },
    });
    if (!r?.address)
      throw new NotFoundException('This unsubscribe link is not valid.');
    const s = await this.prisma.outreachSuppression.findUnique({
      where: {
        organizationId_address: {
          organizationId: r.organizationId,
          address: r.address,
        },
      },
    });
    return { unsubscribed: Boolean(s) };
  }

  async unsubscribe(token: string) {
    const r = await this.prisma.campaignRecipient.findUnique({
      where: { unsubscribeToken: token },
    });
    if (!r?.address)
      throw new NotFoundException('This unsubscribe link is not valid.');
    const before = await this.prisma.outreachSuppression.findUnique({
      where: {
        organizationId_address: {
          organizationId: r.organizationId,
          address: r.address,
        },
      },
    });
    if (before) return { unsubscribed: true };
    await this.prisma.$transaction(async (tx) => {
      await this.events.suppress(
        tx,
        r.organizationId,
        r.address!,
        'UNSUBSCRIBED',
        'unsubscribe_link',
        r.buyerCompanyId,
      );
      const last = await tx.outreachMessage.findFirst({
        where: { recipientId: r.id, sentAt: { not: null } },
        orderBy: { stepOrder: 'desc' },
      });
      if (last) await this.events.event(tx, last, 'UNSUBSCRIBED', 'SYSTEM');
    });
    await this.audit.record({
      organizationId: r.organizationId,
      actorId: null,
      action: 'recipient.unsubscribed',
      entityType: 'CampaignRecipient',
      entityId: r.id,
      metadata: { campaignId: r.campaignId },
    });
    return { unsubscribed: true };
  }
}

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
