import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
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
import {
  CERT_VERIFICATION,
  PRICE_BASES,
  QUALITY_STATUSES,
  SUPPLIER_ATTACHMENT_CATEGORIES,
  SUPPLIER_PAYMENT_TRIGGERS,
  SUPPLIER_TYPES,
  SUPPLIER_VERIFICATION,
} from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);
const NUM = /^\d{1,14}(\.\d{1,4})?$/;
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const PCT = /^\d{1,3}(\.\d{1,4})?$/;
const CUR = /^[A-Z]{3}$/;

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class SupplierProductDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsString() @MinLength(2) @MaxLength(160) productName: string;
  @IsOptional() @nullable() @Matches(/^\d{4,8}$/) hsCode?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) specification?:
    string | null;
  @IsOptional() @nullable() @Matches(NUM) moq?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) moqUnit?: string | null;
  @IsOptional() @nullable() @Matches(NUM) capacity?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) capacityUnit?:
    string | null;
  @IsOptional()
  @nullable()
  @IsIn(['DAY', 'WEEK', 'MONTH', 'YEAR'])
  capacityPeriod?: string | null;
  @IsOptional() @nullable() @Matches(NUM) indicativePrice?: string | null;
  @IsOptional() @nullable() @Matches(CUR) currency?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) priceUnit?:
    string | null;
  @IsOptional()
  @nullable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  leadTimeDays?: number | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) packaging?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) originState?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) notes?: string | null;
}

export class SupplierDto extends VersionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) legalName?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(200) tradeName?:
    string | null;
  @IsOptional() @nullable() @IsIn(SUPPLIER_TYPES) supplierType?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) state?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) city?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(120) contactPerson?:
    string | null;
  @IsOptional() @nullable() @IsEmail() email?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) website?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) gstin?: string | null;
  @IsOptional() @nullable() @Matches(/^[A-Z]{5}\d{4}[A-Z]$/) pan?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsIn(['USER_ADDED', 'IMPORTED']) source?: string;
  @IsOptional()
  @IsIn(SUPPLIER_VERIFICATION.filter((v) => v !== 'EXTERNAL_VERIFIED'))
  verificationStatus?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SupplierProductDto)
  products?: SupplierProductDto[];
  /** Continue despite a possible-duplicate warning (exact duplicates are always blocked). */
  @IsOptional() @IsBoolean() acknowledgePossibleDuplicate?: boolean;
}

export class CertificationDto {
  @IsString() @MinLength(2) @MaxLength(80) type: string;
  @IsOptional() @nullable() @IsString() @MaxLength(80) number?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) issuingBody?:
    string | null;
  @IsOptional() @nullable() @IsDateString() issueDate?: string | null;
  @IsOptional() @nullable() @IsDateString() expiryDate?: string | null;
  @IsOptional()
  @IsIn(CERT_VERIFICATION.filter((v) => v !== 'EXTERNAL_VERIFIED'))
  verification?: string;
}

export class AttachmentMetaDto {
  @IsOptional() @IsIn(SUPPLIER_ATTACHMENT_CATEGORIES) category?: string;
  @IsOptional() @IsString() @MaxLength(40) certificationId?: string;
}

export class SupplierSearchDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(100) product?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsIn(SUPPLIER_TYPES) supplierType?: string;
  @IsOptional() @IsString() @MaxLength(200) certifications?: string;
  @IsOptional() @Matches(NUM) maxMoq?: string;
  @IsOptional() @IsString() @MaxLength(20) moqUnit?: string;
  @IsOptional() @Matches(NUM) minCapacity?: string;
  @IsOptional() @Matches(NUM) maxPrice?: string;
  @IsOptional() @Matches(CUR) priceCurrency?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  maxLeadTimeDays?: number;
  @IsOptional() @Matches(NUM) quantity?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsIn(['true', 'false']) shortlisted?: string;
  @IsOptional() @IsString() @MaxLength(40) opportunityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class ShortlistDto {
  @IsOptional() @IsString() @MaxLength(160) product?: string;
  @IsOptional() @IsBoolean() remove?: boolean;
}

export class RfqDto extends VersionDto {
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) productName?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) specification?:
    string | null;
  @IsOptional() @Matches(NUM) quantity?: string;
  @IsOptional() @nullable() @Matches(PCT) wastagePercent?: string | null;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @nullable() @IsDateString() requiredBy?: string | null;
  @IsOptional() @nullable() @IsDateString() quoteDueDate?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) deliveryLocation?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) packaging?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) qualityRequirements?:
    string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  certificationsRequired?: string[];
  @IsOptional() @nullable() @IsString() @MaxLength(300) paymentTermsRequested?:
    string | null;
  @IsOptional() @nullable() @IsDateString() validUntil?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsString() @MaxLength(40) buyerPurchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) shipmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) opportunityId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  supplierIds?: string[];
}

export class RecordRequestedDto {
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) supplierIds: string[];
  @IsIn(['EMAIL', 'WHATSAPP', 'PHONE', 'PORTAL', 'OTHER']) via: string;
}

export class ReasonDto extends VersionDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class QuoteDto extends VersionDto {
  @IsString() @MaxLength(40) supplierId: string;
  @IsOptional() @nullable() @IsString() @MaxLength(80) quoteReference?:
    string | null;
  @IsOptional() @nullable() @IsDateString() quoteDate?: string | null;
  @IsOptional() @nullable() @IsDateString() validUntil?: string | null;
  @IsOptional() @nullable() @Matches(NUM) quantity?: string | null;
  @IsString() @MaxLength(20) unit: string;
  @Matches(NUM) unitPrice: string;
  @Matches(CUR) currency: string;
  @IsOptional() @IsIn(PRICE_BASES) priceBasis?: string;
  @IsOptional() @nullable() @Matches(NUM) moq?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) moqUnit?: string | null;
  @IsOptional()
  @nullable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  leadTimeDays?: number | null;
  @IsOptional() @nullable() @Matches(NUM) capacity?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20) capacityUnit?:
    string | null;
  @IsOptional()
  @nullable()
  @IsIn(['DAY', 'WEEK', 'MONTH', 'YEAR'])
  capacityPeriod?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) deliveryTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) paymentTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) packaging?:
    string | null;
  @IsOptional() @nullable() @Matches(PCT) taxPercent?: string | null;
  @IsOptional() @nullable() @IsBoolean() taxIncluded?: boolean | null;
  @IsOptional() @nullable() @Matches(NUM) packagingPerUnit?: string | null;
  @IsOptional() @nullable() @Matches(NUM) inlandTransportPerUnit?:
    string | null;
  @IsOptional() @nullable() @Matches(MONEY) inspectionTotal?: string | null;
  @IsOptional() @nullable() @Matches(MONEY) otherTotal?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  certificationsOffered?: string[];
  @IsOptional() @nullable() @IsString() @MaxLength(2000) specificationOffered?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
}

export class ReviewQuoteDto extends VersionDto {
  @IsIn(['CONFIRMED', 'REJECTED']) decision: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CompareDto {
  @IsOptional() @Matches(CUR) targetCurrency?: string;
}

export class SelectQuoteDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  expiredOverrideReason?: string;
}

export class UseInCostingDto {
  @IsOptional() @IsString() @MaxLength(40) costingId?: string;
  /** Explicit confirmation; without it a preview is returned and nothing changes. */
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class ScheduleDto {
  @IsString() @MinLength(1) @MaxLength(120) label: string;
  @IsOptional() @nullable() @Matches(PCT) percentage?: string | null;
  @IsIn(SUPPLIER_PAYMENT_TRIGGERS) trigger: string;
  @IsOptional()
  @nullable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  dueDays?: number | null;
  @IsOptional() @nullable() @IsDateString() fixedDate?: string | null;
}

export class SpoItemDto {
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsString() @MinLength(2) @MaxLength(160) productName: string;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) specification?:
    string | null;
  @Matches(NUM) quantity: string;
  @IsString() @MaxLength(20) unit: string;
  @Matches(NUM) unitPrice: string;
  @IsOptional() @nullable() @Matches(PCT) taxPercent?: string | null;
}

export class SpoDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(40) quoteId?: string;
  @IsOptional() @IsString() @MaxLength(40) supplierId?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerPurchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) shipmentId?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SpoItemDto)
  items?: SpoItemDto[];
  @IsOptional() @nullable() @Matches(MONEY) packagingCost?: string | null;
  @IsOptional() @nullable() @Matches(MONEY) inlandTransportCost?: string | null;
  @IsOptional() @nullable() @Matches(MONEY) inspectionCost?: string | null;
  @IsOptional() @nullable() @Matches(MONEY) otherCharges?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) deliveryLocation?:
    string | null;
  @IsOptional() @nullable() @IsDateString() expectedDate?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) paymentTerms?:
    string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ScheduleDto)
  paymentSchedule?: ScheduleDto[];
  @IsOptional() @nullable() @IsString() @MaxLength(2000) qualityRequirements?:
    string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  certificationRequirements?: string[];
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
  /** Expected-date changes after issue are operational updates and need a reason. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  dateChangeReason?: string;
}

export class ReviseDto extends SpoDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class SpoStatusDto extends VersionDto {
  @IsIn([
    'ACKNOWLEDGED',
    'IN_PRODUCTION',
    'READY',
    'DISPATCHED',
    'COMPLETED',
    'CANCELLED',
  ])
  status: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RecordSentDto {
  @IsIn(['EMAIL', 'WHATSAPP', 'PHONE', 'PORTAL', 'OTHER']) via: string;
}

export class GrnItemDto {
  @IsString() @MaxLength(40) supplierPoItemId: string;
  @Matches(NUM) receivedQuantity: string;
  @IsOptional() @Matches(NUM) damagedQuantity?: string;
}

export class GrnDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GrnItemDto)
  items: GrnItemDto[];
  @IsDateString() receivedAt: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overReceiptReason?: string;
}

export class CheckDto {
  @IsString() @MinLength(1) @MaxLength(200) requirement: string;
  @IsIn(['PASS', 'FAIL', 'NA']) result: string;
  @IsOptional() @nullable() @IsString() @MaxLength(500) note?: string | null;
}

export class InspectionDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(40) itemId?: string;
  @IsIn(QUALITY_STATUSES.filter((s) => s !== 'PENDING')) status: string;
  @IsOptional() @IsDateString() inspectedAt?: string;
  @IsOptional() @Matches(NUM) acceptedQuantity?: string;
  @IsOptional() @Matches(NUM) rejectedQuantity?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CheckDto)
  checks?: CheckDto[];
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class SupplierPaymentDto extends VersionDto {
  @Matches(MONEY) amount: string;
  @Matches(CUR) currency: string;
  @IsDateString() paidAt: string;
  @IsIn(['BANK_TRANSFER', 'RTGS', 'NEFT', 'UPI', 'CHEQUE', 'CASH', 'OTHER'])
  method: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(160) bankName?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsString() @MaxLength(40) installmentId?: string;
  @IsOptional() @Matches(/^\d{1,10}(\.\d{1,10})?$/) fxRate?: string;
}

export class ListDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(40) supplierId?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerPurchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) shipmentId?: string;
  @IsOptional() @IsString() @MaxLength(80) product?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsIn(QUALITY_STATUSES) quality?: string;
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class ProcurementSourceDto extends VersionDto {
  @IsIn(['LINKED', 'MANUAL']) source: string;
}
