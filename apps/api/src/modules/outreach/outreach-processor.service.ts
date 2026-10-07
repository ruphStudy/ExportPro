import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { OutreachEventsService } from './outreach-events.service';
import {
  maskAddress,
  normalizeAddress,
  render,
  textToHtml,
  withFooter,
  type VariableValues,
} from './outreach-rules';
import { DevelopmentOutreachProvider } from './providers/development.provider';
import {
  OUTREACH_PROVIDER,
  type OutreachProvider,
  OutreachSendError,
} from './providers/outreach-provider';

const BATCH = 25;
const MAX_ATTEMPTS = 3;
/** A QUEUED claim older than this is assumed abandoned (crash) and re-queued. */
const STALE_LOCK_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

export const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Lightweight DB-backed campaign scheduler (no Redis/queue infrastructure).
 * State lives entirely in outreach_messages, so a restart simply picks up
 * overdue SCHEDULED rows. Claims use FOR UPDATE SKIP LOCKED + an atomic
 * status transition, so several API instances never send the same message.
 */
@Injectable()
export class OutreachProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutreachProcessorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly devProvider = new DevelopmentOutreachProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OutreachEventsService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(OUTREACH_PROVIDER) private readonly provider: OutreachProvider,
  ) {}

  onModuleInit() {
    const cfg = this.config.get('outreach', { infer: true });
    const env = this.config.get('app.nodeEnv', { infer: true });
    if (!cfg.processorEnabled || env === 'test') return;
    this.timer = setInterval(() => void this.tick(), cfg.processorIntervalMs);
    this.timer.unref();
    // Recovery: process anything that became due while the app was offline.
    setTimeout(() => void this.tick(), 2000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Non-blocking trigger (e.g. right after "Send now"). */
  kick() {
    setImmediate(() => void this.tick());
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      let n = 0;
      do n = await this.processDue(new Date());
      while (n === BATCH);
    } catch (e) {
      this.logger.error(`Outreach processing failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async processDue(now: Date): Promise<number> {
    // Recover claims abandoned by a crashed worker.
    await this.prisma.outreachMessage.updateMany({
      where: {
        status: 'QUEUED',
        lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) },
      },
      data: { status: 'SCHEDULED', lockedAt: null },
    });
    // Columns are UTC `timestamp` (no zone); normalise the parameter to UTC so
    // the DB session timezone can never shift the comparison.
    const nowUtc = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'UTC')`;
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "outreach_messages" SET "status" = 'QUEUED', "lockedAt" = ${nowUtc}
      WHERE "id" IN (
        SELECT m."id" FROM "outreach_messages" m
        JOIN "outreach_campaigns" c ON c."id" = m."campaignId"
        WHERE m."status" = 'SCHEDULED' AND m."testSend" = false
          AND m."scheduledAt" <= ${nowUtc}
          AND c."status" IN ('SCHEDULED', 'RUNNING')
        ORDER BY m."scheduledAt" ASC
        LIMIT ${BATCH}
        FOR UPDATE OF m SKIP LOCKED
      ) AND "status" = 'SCHEDULED'
      RETURNING "id"`);
    for (const { id } of claimed) {
      try {
        await this.processOne(id, now);
      } catch (e) {
        this.logger.error(
          `Message ${id} processing error: ${(e as Error).message}`,
        );
        await this.prisma.outreachMessage.updateMany({
          where: { id, status: 'QUEUED' },
          data: { status: 'SCHEDULED', lockedAt: null },
        });
      }
    }
    await this.settleCampaigns();
    return claimed.length;
  }

  private async processOne(id: string, now: Date) {
    const m = await this.prisma.outreachMessage.findUniqueOrThrow({
      where: { id },
      include: { campaign: { include: { steps: true } }, recipient: true },
    });
    const c = m.campaign!;
    const r = m.recipient;
    const release = (data: Prisma.OutreachMessageUpdateInput) =>
      this.prisma.outreachMessage.update({
        where: { id },
        data: { ...data, lockedAt: null },
      });

    // Re-check every stop condition immediately before sending.
    if (c.status !== 'SCHEDULED' && c.status !== 'RUNNING')
      return release({
        status: c.status === 'PAUSED' ? 'SCHEDULED' : 'CANCELLED',
      });
    if (!r || r.status !== 'ACTIVE') return release({ status: 'CANCELLED' });
    const sup = await this.prisma.outreachSuppression.findUnique({
      where: {
        organizationId_address: {
          organizationId: m.organizationId,
          address: normalizeAddress(m.toAddress),
        },
      },
    });
    if (sup) {
      await release({ status: 'OPTED_OUT' });
      await this.events.stopRecipient(
        this.prisma,
        r.id,
        sup.reason === 'HARD_BOUNCE' ? 'BOUNCED' : 'OPTED_OUT',
      );
      return;
    }
    const production = c.deliveryMode === 'PRODUCTION';
    if (production && r.isDemo) {
      // Defence in depth — demo recipients are excluded at launch already.
      await release({
        status: 'CANCELLED',
        lastError: 'Demo recipient blocked from real delivery.',
      });
      await this.events.stopRecipient(this.prisma, r.id, 'CANCELLED');
      return;
    }
    const settings = await this.prisma.organizationOutreachSettings.findUnique({
      where: { organizationId: m.organizationId },
    });
    const sentToday = await this.prisma.outreachMessage.count({
      where: {
        organizationId: m.organizationId,
        testSend: false,
        sentAt: { gte: startOfUtcDay(now) },
      },
    });
    if (sentToday >= (settings?.dailyLimit ?? 50))
      // Daily limit reached: defer to the next UTC day; nothing is dropped.
      return release({
        status: 'SCHEDULED',
        scheduledAt: new Date(startOfUtcDay(now).getTime() + DAY_MS + 60_000),
      });

    // Development campaigns are ALWAYS simulated, even if a real provider is configured later.
    const provider = production ? this.provider : this.devProvider;
    if (
      production &&
      (provider.deliveryMode !== 'PRODUCTION' || !provider.configured)
    )
      return release({
        status: 'SCHEDULED',
        lastError: 'Email provider is not configured; waiting.',
        scheduledAt: new Date(now.getTime() + 15 * 60_000),
      });

    const unsubscribeUrl = `${this.config.get('app.frontendUrl', { infer: true })}/unsubscribe/${r.unsubscribeToken}`;
    try {
      const res = await provider.send({
        channel: 'EMAIL',
        idempotencyKey: m.idempotencyKey,
        to: m.toAddress,
        fromName: c.fromName ?? c.companyName ?? 'Exporter',
        fromEmail: c.fromEmail ?? 'no-reply@example.invalid',
        replyTo: c.replyTo,
        subject: m.subject,
        text: m.body,
        html: textToHtml(m.body),
        unsubscribeUrl: production ? unsubscribeUrl : null,
        testSend: false,
      });
      const sentAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.outreachMessage.update({
          where: { id },
          data: {
            status: 'SENT',
            sentAt,
            lockedAt: null,
            attempts: { increment: 1 },
            providerMessageId: res.providerMessageId,
            simulated: res.simulated,
            provider: provider.name,
            lastError: null,
          },
        });
        await this.events.event(
          tx,
          m,
          'SENT',
          res.simulated ? 'DEVELOPMENT' : 'PROVIDER',
          { provider: provider.name },
        );
        await this.events.crmActivity(tx, {
          organizationId: m.organizationId,
          leadId: m.crmLeadId,
          direction: 'OUTBOUND',
          title: res.simulated
            ? `Campaign email recorded (development — not delivered): ${c.name}`
            : `Campaign email sent: ${c.name}${m.stepOrder ? ` (follow-up ${m.stepOrder})` : ''}`,
          occurredAt: sentAt,
          metadata: {
            campaignId: c.id,
            messageId: m.id,
            stepOrder: m.stepOrder,
            simulated: res.simulated,
          },
          touchLastActivity: !res.simulated,
        });
        // Schedule the next step relative to this actual send.
        const next = c.steps.find(
          (s) => s.order === m.stepOrder + 1 && s.active,
        );
        if (next) {
          const values = (r.personalization ?? {}) as VariableValues;
          const out = render(next.subject, next.body, {
            ...values,
            unsubscribeLink: unsubscribeUrl,
          });
          await tx.outreachMessage.createMany({
            data: [
              {
                organizationId: m.organizationId,
                campaignId: c.id,
                recipientId: r.id,
                buyerCompanyId: m.buyerCompanyId,
                crmLeadId: m.crmLeadId,
                stepOrder: next.order,
                idempotencyKey: `${r.id}:${next.order}`,
                toAddress: m.toAddress,
                fromAddress: m.fromAddress,
                subject: out.subject,
                body: withFooter(out.body, c.signature, unsubscribeUrl),
                provider: provider.name,
                status: out.unresolved.length ? 'CANCELLED' : 'SCHEDULED',
                lastError: out.unresolved.length
                  ? `Unresolved: ${out.unresolved.join(', ')}`
                  : null,
                scheduledAt: new Date(
                  sentAt.getTime() + next.delayDays * DAY_MS,
                ),
              },
            ],
            skipDuplicates: true,
          });
        } else {
          await tx.campaignRecipient.update({
            where: { id: r.id },
            data: { status: 'COMPLETED' },
          });
        }
      });
    } catch (e) {
      const permanent = e instanceof OutreachSendError ? e.permanent : false;
      const attempts = m.attempts + 1;
      const msg =
        e instanceof OutreachSendError
          ? e.message
          : 'Unexpected provider error.';
      this.logger.warn(
        `Send to ${maskAddress(m.toAddress)} failed (${permanent ? 'permanent' : 'transient'}, attempt ${attempts}).`,
      );
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await this.prisma.$transaction(async (tx) => {
          await tx.outreachMessage.update({
            where: { id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              attempts,
              lastError: msg,
              lockedAt: null,
            },
          });
          await this.events.event(tx, m, 'FAILED', 'SYSTEM', {
            metadata: { permanent, attempts },
          });
          await this.events.stopRecipient(tx, r.id, 'FAILED');
        });
      } else {
        // Bounded exponential backoff: 2, 4 minutes.
        await release({
          status: 'SCHEDULED',
          attempts,
          lastError: msg,
          scheduledAt: new Date(now.getTime() + 2 ** attempts * 60_000),
        });
      }
    }
  }

  /** SCHEDULED → RUNNING once sending starts; RUNNING → COMPLETED when nothing is left. */
  private async settleCampaigns() {
    const active = await this.prisma.outreachCampaign.findMany({
      where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
      select: {
        id: true,
        status: true,
        _count: {
          select: {
            messages: {
              where: {
                status: { in: ['SCHEDULED', 'QUEUED'] },
                testSend: false,
              },
            },
          },
        },
      },
    });
    for (const c of active) {
      if (c._count.messages === 0)
        await this.prisma.outreachCampaign.updateMany({
          where: { id: c.id, status: c.status },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      else if (c.status === 'SCHEDULED')
        await this.prisma.outreachCampaign.updateMany({
          where: {
            id: c.id,
            status: 'SCHEDULED',
            messages: { some: { sentAt: { not: null } } },
          },
          data: { status: 'RUNNING' },
        });
    }
  }
}
