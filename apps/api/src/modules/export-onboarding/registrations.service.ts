import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Registration,
  RegistrationType as PrismaRegistrationType,
} from '@prisma/client';
import {
  OnboardingDocumentSummary,
  RegistrationSummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpsertRegistrationDto } from './dto/registration.dto';

/**
 * Basic structural checks only — see ARCHITECTURE.md "No Fake
 * Government Verification". A number passing this regex becomes
 * FORMAT_VALID, never VERIFIED. APEDA has no well-known simple pattern,
 * so it is intentionally omitted — its numbers stay USER_DECLARED.
 */
const FORMAT_PATTERNS: Partial<Record<PrismaRegistrationType, RegExp>> = {
  IEC: /^\d{10}$/,
  GST: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/,
  FSSAI: /^\d{14}$/,
};

interface DocLike {
  id: string;
  documentType: string;
  originalFilename: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}
type RegistrationWithDocs = Registration & { documents: DocLike[] };

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toDocSummary(doc: DocLike): OnboardingDocumentSummary {
    return {
      id: doc.id,
      documentType:
        doc.documentType as OnboardingDocumentSummary['documentType'],
      originalFilename: doc.originalFilename,
      url: doc.storageUrl,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt.toISOString(),
    };
  }

  toSummary(row: RegistrationWithDocs): RegistrationSummary {
    return {
      id: row.id,
      type: row.type as RegistrationSummary['type'],
      status: row.status as RegistrationSummary['status'],
      number: row.number,
      verificationStatus:
        row.verificationStatus as RegistrationSummary['verificationStatus'],
      issueDate: row.issueDate ? row.issueDate.toISOString() : null,
      expiryDate: row.expiryDate ? row.expiryDate.toISOString() : null,
      documents: row.documents.map((d) => this.toDocSummary(d)),
    };
  }

  async list(organizationId: string): Promise<RegistrationSummary[]> {
    const rows = await this.prisma.registration.findMany({
      where: { organizationId },
      include: { documents: true },
      orderBy: { type: 'asc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  /** Document-presence beats format-validity beats plain user entry — see ARCHITECTURE.md "Verification Status". */
  private computeVerificationStatus(
    type: PrismaRegistrationType,
    number: string | null | undefined,
    hasDocument: boolean,
  ): 'NOT_PROVIDED' | 'USER_DECLARED' | 'FORMAT_VALID' | 'DOCUMENT_UPLOADED' {
    if (hasDocument) return 'DOCUMENT_UPLOADED';
    if (!number) return 'NOT_PROVIDED';
    const pattern = FORMAT_PATTERNS[type];
    if (pattern && pattern.test(number)) return 'FORMAT_VALID';
    return 'USER_DECLARED';
  }

  async upsert(
    organizationId: string,
    actorId: string,
    type: PrismaRegistrationType,
    dto: UpsertRegistrationDto,
  ): Promise<RegistrationSummary> {
    if (
      dto.issueDate &&
      dto.expiryDate &&
      new Date(dto.expiryDate) < new Date(dto.issueDate)
    ) {
      throw new BadRequestException(
        'Expiry date cannot be before the issue date.',
      );
    }

    const existing = await this.prisma.registration.findUnique({
      where: { organizationId_type: { organizationId, type } },
      include: { documents: true },
    });
    const hasDocument = (existing?.documents.length ?? 0) > 0;
    const verificationStatus = this.computeVerificationStatus(
      type,
      dto.number,
      hasDocument,
    );

    const data = {
      status: dto.status,
      number: dto.number,
      issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      verificationStatus,
    };

    const row = await this.prisma.registration.upsert({
      where: { organizationId_type: { organizationId, type } },
      create: { organizationId, type, ...data },
      update: data,
      include: { documents: true },
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: existing
        ? 'onboarding.registration_updated'
        : 'onboarding.registration_added',
      entityType: 'Registration',
      entityId: row.id,
      metadata: { type },
    });
    return this.toSummary(row);
  }

  /** Called after a document is attached/removed so verificationStatus reflects current evidence. */
  async recomputeAfterDocumentChange(registrationId: string): Promise<void> {
    const row = await this.prisma.registration.findUniqueOrThrow({
      where: { id: registrationId },
      include: { documents: true },
    });
    const verificationStatus = this.computeVerificationStatus(
      row.type,
      row.number,
      row.documents.length > 0,
    );
    if (verificationStatus !== row.verificationStatus) {
      await this.prisma.registration.update({
        where: { id: registrationId },
        data: { verificationStatus },
      });
    }
  }
}
