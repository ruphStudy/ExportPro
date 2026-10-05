import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordAuditEventInput {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Single write path for the audit trail. Features that mutate sensitive
 * data (users, organizations, quotations, compliance approvals, ...)
 * should call `record()` from their own service rather than writing to
 * AuditLog directly — that keeps the shape of an audit entry consistent
 * no matter which future module produces it.
 *
 * No business module calls this yet in Sprint 1 — there is nothing
 * sensitive to audit until Sprint 2 adds real mutations.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput) {
    return this.prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
