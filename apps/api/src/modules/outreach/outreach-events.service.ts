import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  OutreachEventType,
  OutreachMessageStatus,
  RecipientStatus,
  SuppressionReason,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiryIntakeService } from '../inquiries/inquiry-intake.service';
import { normalizeAddress, SUPPRESSION_EXCLUSION } from './outreach-rules';
import type { NormalizedProviderEvent } from './providers/outreach-provider';

type Db = PrismaService | Prisma.TransactionClient;

/** Higher rank = further along; statuses never move backwards on events. */
const RANK: Record<OutreachMessageStatus, number> = {
  DRAFT: 0,
  SCHEDULED: 1,
  QUEUED: 2,
  SENT: 3,
  DELIVERED: 4,
  OPENED: 5,
  REPLIED: 6,
  BOUNCED: 6,
  FAILED: 6,
  CANCELLED: 6,
  OPTED_OUT: 6,
};

/**
 * Message events, stop rules, suppression and CRM linkage shared by the
 * processor, webhooks, manual actions and unsubscribe.
 */
@Injectable()
export class OutreachEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: InquiryIntakeService,
  ) {}

  /** Stop-on-reply / bounce / opt-out / cancel: no further sends for this recipient. */
  async stopRecipient(db: Db, recipientId: string, status: RecipientStatus) {
    await db.campaignRecipient.update({
      where: { id: recipientId },
      data: { status },
    });
    await db.outreachMessage.updateMany({
      where: { recipientId, status: { in: ['SCHEDULED', 'QUEUED', 'DRAFT'] } },
      data: { status: 'CANCELLED', lockedAt: null },
    });
  }

  /** Org-wide suppression + stop every active recipient using that address. */
  async suppress(
    db: Db,
    organizationId: string,
    address: string,
    reason: SuppressionReason,
    source: string,
    buyerCompanyId?: string | null,
  ) {
    const addr = normalizeAddress(address);
    await db.outreachSuppression.upsert({
      where: { organizationId_address: { organizationId, address: addr } },
      create: {
        organizationId,
        address: addr,
        reason,
        source,
        buyerCompanyId: buyerCompanyId ?? null,
      },
      update: {},
    });
    const active = await db.campaignRecipient.findMany({
      where: {
        organizationId,
        address: addr,
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      select: { id: true },
    });
    const stopStatus: RecipientStatus =
      reason === 'HARD_BOUNCE' ? 'BOUNCED' : 'OPTED_OUT';
    for (const r of active) await this.stopRecipient(db, r.id, stopStatus);
    // Not-yet-launched (draft) recipients are simply excluded with the reason.
    await db.campaignRecipient.updateMany({
      where: { organizationId, address: addr, status: 'PENDING' },
      data: {
        status: 'EXCLUDED',
        excludedReason: SUPPRESSION_EXCLUSION[reason],
      },
    });
  }

  async event(
    db: Db,
    m: { id: string; organizationId: string },
    type: OutreachEventType,
    source: 'PROVIDER' | 'MANUAL' | 'SYSTEM' | 'DEVELOPMENT',
    extra: {
      provider?: string;
      providerEventId?: string;
      occurredAt?: Date;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return db.outreachMessageEvent.create({
      data: {
        organizationId: m.organizationId,
        messageId: m.id,
        type,
        source,
        provider: extra.provider ?? null,
        providerEventId: extra.providerEventId ?? null,
        occurredAt: extra.occurredAt ?? new Date(),
        metadata: (extra.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Links a communication to the CRM lead timeline (Sprint 11). Only a
   * short reference is stored — the message body stays in OutreachMessage.
   * Stage is never changed; Sprint 11 suggestions read these activities.
   */
  async crmActivity(
    db: Db,
    a: {
      organizationId: string;
      leadId: string | null;
      direction: 'INBOUND' | 'OUTBOUND';
      title: string;
      occurredAt: Date;
      metadata: Record<string, unknown>;
      /** Real sends and recorded replies count as engagement; simulated sends do not. */
      touchLastActivity: boolean;
      actorUserId?: string | null;
    },
  ) {
    if (!a.leadId) return;
    const lead = await db.buyerLead.findFirst({
      where: { id: a.leadId, organizationId: a.organizationId },
      select: { id: true, lastActivityAt: true },
    });
    if (!lead) return;
    await db.leadActivity.create({
      data: {
        organizationId: a.organizationId,
        leadId: lead.id,
        type: 'EMAIL',
        title: a.title,
        direction: a.direction,
        occurredAt: a.occurredAt,
        actorUserId: a.actorUserId ?? null,
        metadata: a.metadata as Prisma.InputJsonValue,
      },
    });
    if (a.touchLastActivity && a.occurredAt > lead.lastActivityAt)
      await db.buyerLead.update({
        where: { id: lead.id },
        data: { lastActivityAt: a.occurredAt },
      });
  }

  /** Applies one verified provider event idempotently. */
  async applyProviderEvent(provider: string, e: NormalizedProviderEvent) {
    const m = await this.prisma.outreachMessage.findFirst({
      where: { provider, providerMessageId: e.providerMessageId },
    });
    if (!m) return 'ignored';
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.event(tx, m, e.type, 'PROVIDER', {
          provider,
          providerEventId: e.providerEventId,
          occurredAt: e.occurredAt,
          metadata: e.metadata,
        });
        const advance = (to: OutreachMessageStatus) =>
          RANK[to] > RANK[m.status] ? to : m.status;
        if (e.type === 'DELIVERED')
          await tx.outreachMessage.update({
            where: { id: m.id },
            data: {
              deliveredAt: m.deliveredAt ?? e.occurredAt,
              status: advance('DELIVERED'),
            },
          });
        else if (e.type === 'OPENED')
          await tx.outreachMessage.update({
            where: { id: m.id },
            data: {
              openedAt: m.openedAt ?? e.occurredAt,
              status: advance('OPENED'),
            },
          });
        else if (e.type === 'FAILED')
          await tx.outreachMessage.update({
            where: { id: m.id },
            data: { failedAt: e.occurredAt, status: 'FAILED' },
          });
        else if (e.type === 'BOUNCED' && e.permanentBounce) {
          await tx.outreachMessage.update({
            where: { id: m.id },
            data: { bouncedAt: e.occurredAt, status: 'BOUNCED' },
          });
          await this.suppress(
            tx,
            m.organizationId,
            m.toAddress,
            'HARD_BOUNCE',
            'provider_bounce',
            m.buyerCompanyId,
          );
          if (m.recipientId)
            await this.stopRecipient(tx, m.recipientId, 'BOUNCED');
        } else if (e.type === 'COMPLAINT') {
          await this.suppress(
            tx,
            m.organizationId,
            m.toAddress,
            'COMPLAINT',
            'provider_complaint',
            m.buyerCompanyId,
          );
          if (m.recipientId)
            await this.stopRecipient(tx, m.recipientId, 'OPTED_OUT');
        }
        // Soft (transient) bounces: recorded only — the provider retries itself; we never loop.
      });
      // Sprint 13: a provider-reported reply opens a NEW inquiry (deduplicated per message).
      if (e.type === 'REPLIED')
        await this.intake.fromOutreachReply(
          m.organizationId,
          m.id,
          null,
          typeof e.metadata.text === 'string' ? e.metadata.text : null,
        );
      return 'applied';
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return 'duplicate';
      throw err;
    }
  }
}
