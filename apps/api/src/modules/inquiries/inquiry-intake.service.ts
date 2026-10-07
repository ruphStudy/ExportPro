import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InquiriesService } from './inquiries.service';

/**
 * Bridge from Sprint 12 outreach: a recorded buyer reply becomes a NEW,
 * unread inquiry linked to the outreach message and CRM lead. Idempotent
 * per outreach message (sourceKey), never qualifies anything, and never
 * fails the caller — reply recording must not depend on it.
 */
@Injectable()
export class InquiryIntakeService {
  private readonly logger = new Logger(InquiryIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inquiries: InquiriesService,
  ) {}

  async fromOutreachReply(
    organizationId: string,
    messageId: string,
    actorUserId: string | null,
    replyText?: string | null,
  ) {
    try {
      const m = await this.prisma.outreachMessage.findFirst({
        where: { id: messageId, organizationId },
      });
      if (!m) return null;
      const placeholder = `The buyer replied to “${m.subject}”. The email provider did not capture the reply content — paste the buyer's message or attach the email, then run extraction.`;
      return await this.inquiries.createInternal(organizationId, actorUserId, {
        source: 'EMAIL_REPLY',
        sourceKey: `outreach:${m.id}`,
        sourceMessageId: m.id,
        buyerCompanyId: m.buyerCompanyId,
        crmLeadId: m.crmLeadId,
        contactEmail: m.toAddress,
        subject: `Re: ${m.subject}`,
        body: replyText?.trim() || placeholder,
        receivedAt: m.repliedAt ?? new Date(),
        requireBuyer: false,
      });
    } catch (error) {
      this.logger.warn(
        `Could not create inquiry from outreach reply ${messageId}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
