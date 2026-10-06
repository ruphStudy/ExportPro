import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingDocumentType, RegistrationType } from '@prisma/client';
import { OnboardingDocumentSummary } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { RegistrationsService } from './registrations.service';
import { CertificationsService } from './certifications.service';

function toSummary(doc: {
  id: string;
  documentType: string;
  originalFilename: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}): OnboardingDocumentSummary {
  return {
    id: doc.id,
    documentType: doc.documentType as OnboardingDocumentSummary['documentType'],
    originalFilename: doc.originalFilename,
    url: doc.storageUrl,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.uploadedAt.toISOString(),
  };
}

/**
 * Upload metadata only — the file bytes go through StorageService (see
 * ARCHITECTURE.md). "Replace" semantics: uploading again for the same
 * registration/certification deletes the previous file first, so a
 * registration/certificate holds at most one current document.
 */
@Injectable()
export class OnboardingDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly registrations: RegistrationsService,
    private readonly certifications: CertificationsService,
  ) {}

  async uploadForRegistration(
    organizationId: string,
    actorId: string,
    type: RegistrationType,
    file: Express.Multer.File,
  ): Promise<OnboardingDocumentSummary> {
    const registration = await this.prisma.registration.findUnique({
      where: { organizationId_type: { organizationId, type } },
    });
    if (!registration)
      throw new NotFoundException(
        `Set a status for ${type} before uploading a document.`,
      );

    await this.replaceExisting({ registrationId: registration.id });
    const { url } = await this.storage.saveDocument(
      'onboarding-documents',
      file,
    );

    const doc = await this.prisma.onboardingDocument.create({
      data: {
        organizationId,
        documentType: type as unknown as OnboardingDocumentType,
        registrationId: registration.id,
        originalFilename: file.originalname,
        storageUrl: url,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: actorId,
      },
    });
    await this.registrations.recomputeAfterDocumentChange(registration.id);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.document_uploaded',
      entityType: 'Registration',
      entityId: registration.id,
      metadata: { documentType: type, filename: file.originalname },
    });
    return toSummary(doc);
  }

  async uploadForCertification(
    organizationId: string,
    actorId: string,
    certificationId: string,
    file: Express.Multer.File,
  ): Promise<OnboardingDocumentSummary> {
    const certification = await this.prisma.certification.findUnique({
      where: { id: certificationId },
    });
    if (!certification) throw new NotFoundException('Certificate not found.');
    if (certification.organizationId !== organizationId)
      throw new ForbiddenException('Not found in this organization.');

    await this.replaceExisting({ certificationId });
    const { url } = await this.storage.saveDocument(
      'onboarding-documents',
      file,
    );

    const doc = await this.prisma.onboardingDocument.create({
      data: {
        organizationId,
        documentType: 'CERTIFICATE',
        certificationId,
        originalFilename: file.originalname,
        storageUrl: url,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: actorId,
      },
    });
    await this.certifications.recomputeAfterDocumentChange(certificationId);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.document_uploaded',
      entityType: 'Certification',
      entityId: certificationId,
      metadata: { filename: file.originalname },
    });
    return toSummary(doc);
  }

  private async replaceExisting(where: {
    registrationId?: string;
    certificationId?: string;
  }) {
    const existing = await this.prisma.onboardingDocument.findMany({ where });
    for (const doc of existing) {
      await this.storage.deleteByUrl(doc.storageUrl);
    }
    await this.prisma.onboardingDocument.deleteMany({ where });
  }

  async remove(
    organizationId: string,
    actorId: string,
    documentId: string,
  ): Promise<{ message: string }> {
    const doc = await this.prisma.onboardingDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    if (doc.organizationId !== organizationId)
      throw new ForbiddenException('Not found in this organization.');

    await this.storage.deleteByUrl(doc.storageUrl);
    await this.prisma.onboardingDocument.delete({ where: { id: documentId } });

    if (doc.registrationId)
      await this.registrations.recomputeAfterDocumentChange(doc.registrationId);
    if (doc.certificationId)
      await this.certifications.recomputeAfterDocumentChange(
        doc.certificationId,
      );

    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.document_removed',
      entityType: doc.registrationId ? 'Registration' : 'Certification',
      entityId: doc.registrationId ?? doc.certificationId ?? doc.id,
      metadata: { filename: doc.originalFilename },
    });
    return { message: 'Document removed.' };
  }
}
