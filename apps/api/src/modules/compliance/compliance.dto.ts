import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  DOCUMENT_SOURCES,
  DOCUMENT_STATUSES,
  GENERATABLE_DOCUMENT_TYPES,
  REQUIREMENT_LEVELS,
  REQUIREMENT_TYPES,
  RESPONSIBLE_PARTIES,
  TRADE_DOCUMENT_TYPES,
} from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);
const ISO2 = /^[A-Z]{2}$/;

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

// ------------------------------------------------------------- compliance

export class UpdateRequirementDto {
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @nullable() @IsDateString() dueDate?: string | null;
  /** Only workflow states may be set by hand; satisfaction always comes from evidence. */
  @IsOptional() @IsIn(['NOT_STARTED', 'IN_PROGRESS']) status?:
    'NOT_STARTED' | 'IN_PROGRESS';
  @IsOptional() @nullable() @IsString() @MaxLength(40) evidenceDocumentId?:
    string | null;
  /** Manual confirmation note (manual requirements only; reviewers). */
  @IsOptional()
  @nullable()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  manualConfirmation?: string | null;
}

export class OverrideDto {
  @IsIn(['NOT_APPLICABLE', 'WAIVED', 'ACCEPTED_RISK']) kind:
    'NOT_APPLICABLE' | 'WAIVED' | 'ACCEPTED_RISK';
  @IsString()
  @MinLength(3, { message: 'A reason is required.' })
  @MaxLength(1000)
  reason: string;
}

export class AddRequirementDto {
  @IsString() @MinLength(3) @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsIn(REQUIREMENT_TYPES) requirementType: (typeof REQUIREMENT_TYPES)[number];
  @IsIn(REQUIREMENT_LEVELS) level: (typeof REQUIREMENT_LEVELS)[number];
  @IsIn(['BLOCKER', 'WARNING', 'INFO']) severity:
    'BLOCKER' | 'WARNING' | 'INFO';
  @IsOptional() @IsIn(['USER_DEFINED', 'BUYER_REQUESTED']) basis?:
    'USER_DEFINED' | 'BUYER_REQUESTED';
  @IsOptional()
  @IsIn(RESPONSIBLE_PARTIES)
  responsibleParty?: (typeof RESPONSIBLE_PARTIES)[number];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(TRADE_DOCUMENT_TYPES, { each: true })
  documentTypes?: string[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Evidence must also have a signed-off document validation (Sprint 17). */
  @IsOptional() @IsBoolean() requiresValidation?: boolean;
}

export class MarkReadyDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ChecklistQueryDto {
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) quotationId?: string;
  @IsOptional()
  @IsIn(['NOT_READY', 'BLOCKED', 'READY_WITH_WARNINGS', 'READY'])
  readiness?: string;
}

// -------------------------------------------------------------- documents

export class GenerateDocumentDto {
  @IsIn(GENERATABLE_DOCUMENT_TYPES)
  documentType: (typeof GENERATABLE_DOCUMENT_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  /** Commercial invoice without an accepted PO (manager-authorized, traceable to an issued PI). */
  @IsOptional() @IsString() @MaxLength(40) proformaInvoiceId?: string;
  /** Required to generate a commercial invoice despite open critical PO discrepancies, or without a PO. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason?: string;
}

/** External/official document recorded by reference (with optional file via /upload). */
export class DocumentMetadataDto {
  @IsIn(TRADE_DOCUMENT_TYPES)
  documentType: (typeof TRADE_DOCUMENT_TYPES)[number];
  @IsIn(DOCUMENT_SOURCES) source: (typeof DOCUMENT_SOURCES)[number];
  @IsOptional()
  @IsIn(RESPONSIBLE_PARTIES)
  responsibleParty?: (typeof RESPONSIBLE_PARTIES)[number];
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(80) documentNumber?: string;
  @IsOptional() @IsString() @MaxLength(160) issuer?: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) quotationId?: string;
  @IsOptional() @IsString() @MaxLength(40) proformaInvoiceId?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @Matches(ISO2) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Link the document as evidence to this requirement (type must match). */
  @IsOptional() @IsString() @MaxLength(40) requirementId?: string;
  /** Replace = new version of an existing uploaded document lineage. */
  @IsOptional() @IsString() @MaxLength(40) replacesDocumentId?: string;
  /** Multipart sends strings; "true" confirms an exact-duplicate upload. */
  @IsOptional() @IsIn(['true', 'false', true, false]) allowDuplicate?:
    string | boolean;
}

export class UpdateDocumentDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(80) documentNumber?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) issuer?: string | null;
  @IsOptional() @nullable() @IsDateString() issueDate?: string | null;
  @IsOptional() @nullable() @IsDateString() expiryDate?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) internalNotes?:
    string | null;
  /** Generated documents only; validated per type in the service. */
  @IsOptional() @IsObject() content?: Record<string, unknown>;
}

export class ApproveDocumentDto extends VersionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason?: string;
}

export class DocReasonDto extends VersionDto {
  @IsString()
  @MinLength(3, { message: 'A reason is required.' })
  @MaxLength(1000)
  reason: string;
}

export class DocumentListQueryDto {
  @IsOptional()
  @IsIn(['all', 'commercial', 'compliance', 'shipment', 'external', 'expiring'])
  tab?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsIn(TRADE_DOCUMENT_TYPES) documentType?: string;
  @IsOptional() @IsIn(DOCUMENT_STATUSES) status?: string;
  @IsOptional() @IsIn(DOCUMENT_SOURCES) source?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @Matches(ISO2) countryCode?: string;
  @IsOptional() @IsIn(['VALID', 'EXPIRING_SOON', 'EXPIRED']) expiry?: string;
  @IsOptional() @IsString() @MaxLength(40) createdBy?: string;
  @IsOptional() @IsIn(['true', 'false']) includeSuperseded?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class TemplateDto {
  @IsIn([
    'COMMERCIAL_INVOICE',
    'PACKING_LIST',
    'SHIPPING_INSTRUCTION',
    'GENERAL',
  ])
  documentType: string;
  @IsOptional() @nullable() @IsString() @MaxLength(300) footer?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(5000) terms?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) declaration?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) signatureLabel?:
    string | null;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiryWarningDays?: number;
  @IsOptional() @IsBoolean() reset?: boolean;
}
