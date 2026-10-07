import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  InquiryPriority,
  InquiryRejectCategory,
  InquirySource,
  InquiryStatus,
} from '@exportpro/types';
import { PAYMENT_TERM_TYPES, RFQ_INCOTERMS } from '@exportpro/types';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = [
  'NEW',
  'REVIEWING',
  'NEEDS_CLARIFICATION',
  'QUALIFIED',
  'REJECTED',
  'ARCHIVED',
  'CONVERTED',
];
const SOURCES = ['EMAIL_REPLY', 'MANUAL', 'RFQ_UPLOAD', 'CRM', 'OTHER'];
const nullable = () => ValidateIf((_, v) => v !== null);
const toBool = () =>
  Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

export class InquiryListQueryDto {
  @IsOptional()
  @IsIn([
    'all',
    'unread',
    'needs_review',
    'qualified',
    'needs_clarification',
    'archived',
    'rfq',
  ])
  tab?: string;
  @IsOptional() @IsIn(['rfq']) type?: 'rfq';
  @IsOptional() @IsIn(STATUSES) status?: InquiryStatus;
  @IsOptional() @IsIn(PRIORITIES) priority?: InquiryPriority;
  @IsOptional() @IsString() @MaxLength(40) assignedTo?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @toBool() @IsBoolean() unread?: boolean;
  @IsOptional() @IsIn(SOURCES) source?: InquirySource;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class CreateInquiryDto {
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(160) buyerName?: string;
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid contact email.' })
  @MaxLength(254)
  contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
  @IsString()
  @MinLength(2, { message: 'Enter a subject.' })
  @MaxLength(300)
  subject: string;
  @IsString()
  @MinLength(5, { message: 'Enter the inquiry message.' })
  @MaxLength(100_000)
  body: string;
  @IsOptional() @IsDateString() receivedAt?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: InquiryPriority;
  @IsOptional() @IsIn(['MANUAL', 'CRM', 'OTHER']) source?:
    'MANUAL' | 'CRM' | 'OTHER';
}

/** Multipart fields for "Upload RFQ" (file is separate). */
export class UploadInquiryDto {
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(160) buyerName?: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(5000) message?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
}

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class UpdateInquiryDto extends VersionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) subject?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: InquiryPriority;
  @IsOptional() @nullable() @IsString() @MaxLength(40) buyerCompanyId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) buyerName?:
    string | null;
  @IsOptional() @nullable() @IsEmail() contactEmail?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) contactName?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) crmLeadId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsOptional() @nullable() @Matches(/^[A-Z]{2}$/) countryCode?: string | null;
}

export class AssignDto extends VersionDto {
  @nullable() @IsString() @MaxLength(40) userId: string | null;
}

export class ConfirmedItemDto {
  @IsString() @MinLength(1) @MaxLength(200) productName: string;
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId: string | null;
  @IsOptional()
  @nullable()
  @Matches(/^\d{4,10}$/, { message: 'HS code must be 4–10 digits.' })
  hsCode: string | null;
  @IsOptional()
  @nullable()
  @Matches(/^\d{1,14}(\.\d{1,4})?$/, {
    message: 'Quantity must be a non-negative number.',
  })
  quantity: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(30) quantityUnit:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) quantityText:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) specification:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) packaging:
    string | null;
  @IsOptional()
  @nullable()
  @Matches(/^\d{1,14}(\.\d{1,6})?$/, {
    message: 'Price must be a non-negative number.',
  })
  targetPrice: string | null;
  @IsOptional() @nullable() @Matches(/^[A-Z]{3}$/) priceCurrency: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(30) priceUnitBasis:
    string | null;
  @IsOptional() @IsBoolean() priceIndicative: boolean;
  @IsOptional() @nullable() @IsString() @MaxLength(60) deliveryDate:
    string | null;
}

class DestinationDto {
  @IsOptional() @nullable() @Matches(/^[A-Z]{2}$/) countryCode: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) city: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) port: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) location: string | null;
}
class IncotermDto {
  @IsOptional() @nullable() @IsIn([...RFQ_INCOTERMS]) term: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) place: string | null;
}
class PaymentDto {
  @IsOptional() @nullable() @IsIn([...PAYMENT_TERM_TYPES]) type: string | null;
  @IsOptional() @nullable() @IsNumber() @Min(0) @Max(100) advancePercent:
    number | null;
  @IsOptional() @nullable() @IsInt() @Min(0) @Max(720) creditDays:
    number | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) raw: string | null;
}
class DeliveryDto {
  @IsOptional() @nullable() @IsString() @MaxLength(60) targetDate:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) shipmentWindow:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) leadTime: string | null;
  @IsOptional() @IsBoolean() urgent: boolean;
}
class SampleDto {
  @IsOptional() @IsBoolean() required: boolean;
  @IsOptional() @nullable() @IsString() @MaxLength(80) quantity: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) specification:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(60) deadline: string | null;
}

export class ConfirmRfqDto extends VersionDto {
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedItemDto)
  items: ConfirmedItemDto[];
  @ValidateNested() @Type(() => DestinationDto) destination: DestinationDto;
  @ValidateNested() @Type(() => IncotermDto) incoterm: IncotermDto;
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  certifications: string[];
  @ValidateNested() @Type(() => PaymentDto) paymentTerms: PaymentDto;
  @ValidateNested() @Type(() => DeliveryDto) delivery: DeliveryDto;
  @ValidateNested() @Type(() => SampleDto) sample: SampleDto;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes: string | null;
  /** Extraction version the user reviewed (null = entered manually). */
  @IsOptional() @nullable() @IsInt() basedOnExtractionVersion?: number | null;
}

export class ChecklistDto {
  @IsBoolean() buyerIdentified: boolean;
  @IsBoolean() productIdentified: boolean;
  @IsBoolean() quantityKnown: boolean;
  @IsBoolean() destinationKnown: boolean;
  @IsBoolean() requirementClear: boolean;
  @IsBoolean() contactAvailable: boolean;
  @IsBoolean() commercialReviewed: boolean;
}

export class QualifyDto extends VersionDto {
  @ValidateNested() @Type(() => ChecklistDto) checklist: ChecklistDto;
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  overrideReason?: string;
}

class QuestionDto {
  @IsString() @MinLength(3) @MaxLength(300) text: string;
  @IsIn(['MANUAL', 'AI_SUGGESTED', 'SYSTEM']) source:
    'MANUAL' | 'AI_SUGGESTED' | 'SYSTEM';
}

export class ClarifyDto extends VersionDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one question.' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];
}

export class RejectDto extends VersionDto {
  @IsIn([
    'NOT_RELEVANT',
    'PRODUCT_UNAVAILABLE',
    'COMMERCIAL_MISMATCH',
    'BUYER_RISK',
    'INCOMPLETE_REQUIREMENT',
    'OTHER',
  ])
  category: InquiryRejectCategory;
  @IsString()
  @MinLength(3, { message: 'A reason is required.' })
  @MaxLength(1000)
  reason: string;
}

export class ApprovalDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class NoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) text: string;
}

export class SampleRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24)
  itemIndex?: number;
}
