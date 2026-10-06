import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Certification } from '@prisma/client';
import {
  CertificationSummary,
  OnboardingDocumentSummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateCertificationDto,
  UpdateCertificationDto,
} from './dto/certification.dto';

interface DocLike {
  id: string;
  documentType: string;
  originalFilename: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}
type CertificationWithDocs = Certification & { documents: DocLike[] };

function statusFromExpiry(expiryDate: Date | null): 'ACTIVE' | 'EXPIRED' {
  return expiryDate && expiryDate.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE';
}

@Injectable()
export class CertificationsService {
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

  toSummary(row: CertificationWithDocs): CertificationSummary {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      number: row.number,
      issuer: row.issuer,
      issueDate: row.issueDate ? row.issueDate.toISOString() : null,
      expiryDate: row.expiryDate ? row.expiryDate.toISOString() : null,
      status: row.status as CertificationSummary['status'],
      verificationStatus:
        row.verificationStatus as CertificationSummary['verificationStatus'],
      notes: row.notes,
      documents: row.documents.map((d) => this.toDocSummary(d)),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(organizationId: string): Promise<CertificationSummary[]> {
    const rows = await this.prisma.certification.findMany({
      where: { organizationId },
      include: { documents: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateCertificationDto,
  ): Promise<CertificationSummary> {
    if (
      dto.issueDate &&
      dto.expiryDate &&
      new Date(dto.expiryDate) < new Date(dto.issueDate)
    ) {
      throw new BadRequestException(
        'Expiry date cannot be before the issue date.',
      );
    }

    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    const row = await this.prisma.certification.create({
      data: {
        organizationId,
        type: dto.type,
        name: dto.name,
        number: dto.number,
        issuer: dto.issuer,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate,
        status: statusFromExpiry(expiryDate),
        notes: dto.notes,
      },
      include: { documents: true },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.certification_added',
      entityType: 'Certification',
      entityId: row.id,
      metadata: { type: dto.type, name: dto.name },
    });
    return this.toSummary(row);
  }

  private async findOwned(
    organizationId: string,
    id: string,
  ): Promise<Certification> {
    const row = await this.prisma.certification.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Certificate not found.');
    if (row.organizationId !== organizationId)
      throw new ForbiddenException('Not found in this organization.');
    return row;
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: UpdateCertificationDto,
  ): Promise<CertificationSummary> {
    const existing = await this.findOwned(organizationId, id);
    const issueDate = dto.issueDate
      ? new Date(dto.issueDate)
      : existing.issueDate;
    const expiryDate = dto.expiryDate
      ? new Date(dto.expiryDate)
      : existing.expiryDate;
    if (issueDate && expiryDate && expiryDate < issueDate) {
      throw new BadRequestException(
        'Expiry date cannot be before the issue date.',
      );
    }

    const row = await this.prisma.certification.update({
      where: { id },
      data: {
        ...dto,
        issueDate,
        expiryDate,
        status: statusFromExpiry(expiryDate),
      },
      include: { documents: true },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.certification_updated',
      entityType: 'Certification',
      entityId: id,
    });
    return this.toSummary(row);
  }

  async remove(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.findOwned(organizationId, id);
    await this.prisma.certification.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.certification_removed',
      entityType: 'Certification',
      entityId: id,
    });
    return { message: 'Certificate removed.' };
  }

  async recomputeAfterDocumentChange(certificationId: string): Promise<void> {
    const hasDocument =
      (await this.prisma.onboardingDocument.count({
        where: { certificationId },
      })) > 0;
    const certification = await this.prisma.certification.findUniqueOrThrow({
      where: { id: certificationId },
    });
    const verificationStatus = hasDocument
      ? 'DOCUMENT_UPLOADED'
      : 'USER_DECLARED';
    if (verificationStatus !== certification.verificationStatus) {
      await this.prisma.certification.update({
        where: { id: certificationId },
        data: { verificationStatus },
      });
    }
  }
}
