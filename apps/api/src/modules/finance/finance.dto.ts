import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
  ACTUAL_COST_CATEGORIES,
  ACTUAL_COST_SOURCES,
  BANK_CHARGE_TYPES,
  INSTALLMENT_TRIGGERS,
  LC_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_TERMS_TYPES,
  REVENUE_ADJUSTMENT_TYPES,
} from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const SIGNED_MONEY = /^-?\d{1,14}(\.\d{1,2})?$/;
const PCT = /^\d{1,3}(\.\d{1,4})?$/;
const RATE = /^\d{1,10}(\.\d{1,10})?$/;
const CUR = /^[A-Z]{3}$/;
const ISO2 = /^[A-Z]{2}$/;

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class FxInputDto {
  @Matches(RATE, { message: 'Enter the exchange rate as a positive number.' })
  rate: string;
  @IsOptional() @IsString() @MaxLength(120) sourceLabel?: string;
  @IsOptional() @IsDateString() sourceDate?: string;
}

export class InstallmentDto {
  @IsString() @MinLength(1) @MaxLength(120) label: string;
  @IsOptional() @nullable() @Matches(PCT) percentage?: string | null;
  @Matches(MONEY) amount: string;
  @IsIn(INSTALLMENT_TRIGGERS) triggerType: string;
  @IsOptional()
  @nullable()
  @Type(() => Number)
  @IsInt()
  @Min(-365)
  @Max(720)
  dueDays?: number | null;
  @IsOptional() @nullable() @IsDateString() fixedDate?: string | null;
}

export class CreateReceivableDto {
  @IsString() @MaxLength(40) purchaseOrderId: string;
  @IsOptional() @IsString() @MaxLength(40) shipmentId?: string;
  @IsIn(PAYMENT_TERMS_TYPES) paymentTermsType: string;
  /** Explicit schedule; required for CUSTOM or when the wording was not recognized. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments?: InstallmentDto[];
  /** The user confirms a schedule that was not read from the documents. */
  @IsOptional() @IsBoolean() confirmCustomSchedule?: boolean;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  termDays?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  tenorDays?: number;
  @IsOptional() @IsString() @MaxLength(160) collectingBank?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => FxInputDto)
  bookingFx?: FxInputDto;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateReceivableDto extends VersionDto {
  @IsOptional() @nullable() @IsDateString() invoiceDate?: string | null;
  @IsOptional()
  @nullable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  termDays?: number | null;
  @IsOptional() @nullable() @IsDateString() documentsPresentedAt?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) collectingBank?:
    string | null;
  @IsOptional() @nullable() @IsDateString() acceptedAt?: string | null;
  @IsOptional()
  @nullable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  tenorDays?: number | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) shipmentId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) ownerUserId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional()
  @ValidateNested()
  @Type(() => FxInputDto)
  bookingFx?: FxInputDto;
  @IsOptional() @IsIn(['CANCELLED', 'UNCOLLECTIBLE']) state?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) reason?: string;
}

export class InstallmentDateDto extends VersionDto {
  @IsOptional() @nullable() @IsDateString() fixedDate?: string | null;
}

export class DisputeDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(40) installmentId?: string;
  @IsOptional() @nullable() @Matches(MONEY) amount?: string | null;
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** true = resolve (clear) the dispute. */
  @IsOptional() @IsBoolean() resolve?: boolean;
}

export class ChargeDto {
  @IsIn(BANK_CHARGE_TYPES) type: string;
  @Matches(MONEY) amount: string;
  @Matches(CUR) currency: string;
}

export class PaymentDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(40) installmentId?: string;
  @Matches(MONEY) amount: string;
  @Matches(CUR) currency: string;
  @IsDateString() receivedAt: string;
  @IsIn(PAYMENT_METHODS) paymentMethod: string;
  @IsOptional() @IsString() @MaxLength(80) bankReference?: string;
  @IsOptional() @IsString() @MaxLength(80) remittanceReference?: string;
  @IsOptional() @IsString() @MaxLength(160) bankName?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Required when the payment currency differs from the receivable currency: 1 payment currency = rate × receivable currency. */
  @IsOptional() @ValidateNested() @Type(() => FxInputDto) fx?: FxInputDto;
  /** Actual settlement rate: 1 receivable currency = rate × reporting currency (for FX gain/loss). */
  @IsOptional()
  @ValidateNested()
  @Type(() => FxInputDto)
  settlementFx?: FxInputDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChargeDto)
  charges?: ChargeDto[];
  @IsOptional() @IsBoolean() allowOverpayment?: boolean;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overpaymentReason?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class LcDocDto {
  @IsString() @MinLength(2) @MaxLength(160) requirement: string;
  @IsOptional() @nullable() @IsString() @MaxLength(40) documentId?:
    string | null;
}

export class LcDto extends VersionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) lcNumber?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) issuingBank?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(160) advisingBank?:
    string | null;
  @IsOptional() @Matches(MONEY) amount?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @nullable() @IsDateString() issueDate?: string | null;
  @IsOptional() @nullable() @IsDateString() expiryDate?: string | null;
  @IsOptional() @nullable() @IsDateString() latestShipmentDate?: string | null;
  @IsOptional() @nullable() @IsDateString() presentationDeadline?:
    string | null;
  @IsOptional() @IsIn(LC_STATUSES) status?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LcDocDto)
  documents?: LcDocDto[];
  @IsOptional() @nullable() @IsString() @MaxLength(2000) notes?: string | null;
}

export class ReminderDto {
  @IsOptional() @IsString() @MaxLength(40) installmentId?: string;
  @IsOptional()
  @IsIn(['UPCOMING_DUE', 'DUE_TODAY', 'OVERDUE', 'FOLLOW_UP'])
  kind?: string;
}

export class RecordSentDto {
  @IsIn(['EMAIL', 'WHATSAPP', 'PHONE', 'OTHER']) channel: string;
}

export class CostDto {
  @IsIn(ACTUAL_COST_CATEGORIES) category: string;
  @IsString() @MinLength(2) @MaxLength(300) description: string;
  @Matches(SIGNED_MONEY) amount: string;
  @Matches(CUR) currency: string;
  /** 1 cost currency = rate × reporting currency. Required unless a saved FX snapshot exists. */
  @IsOptional() @ValidateNested() @Type(() => FxInputDto) fx?: FxInputDto;
  @IsOptional() @IsIn(ACTUAL_COST_SOURCES) source?: string;
  @IsOptional() @IsString() @MaxLength(160) sourceReference?: string;
  @IsOptional() @IsDateString() incurredAt?: string;
  @IsOptional() @IsString() @MaxLength(160) vendorName?: string;
}

export class UpdateCostDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) description?: string;
  @IsOptional() @Matches(SIGNED_MONEY) amount?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @ValidateNested() @Type(() => FxInputDto) fx?: FxInputDto;
  @IsOptional() @IsString() @MaxLength(160) sourceReference?: string;
  @IsOptional() @IsDateString() incurredAt?: string;
  @IsOptional() @IsString() @MaxLength(160) vendorName?: string;
  /** Void the line (kept, excluded from totals). */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) voidReason?: string;
}

export class AdjustmentDto {
  @IsIn(REVENUE_ADJUSTMENT_TYPES) type: string;
  @Matches(MONEY) amount: string;
  @Matches(CUR) currency: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class ConfirmNoneDto extends VersionDto {
  @IsIn(ACTUAL_COST_CATEGORIES) category: string;
  @IsBoolean() none: boolean;
}

export class FinalizeDto extends VersionDto {}

export class ReopenDto extends VersionDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class SettingsDto {
  @IsOptional() @Matches(CUR) reportingCurrency?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  dueSoonDays?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  reorderLeadDays?: number;
}

export class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(40) shipmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) commercialInvoiceId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @Matches(ISO2) country?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @IsString() @MaxLength(40) ownerUserId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional()
  @IsIn(['month', '30d', 'quarter', 'year', 'custom', 'all'])
  range?: string;
  @IsOptional() @IsIn(['true', 'false']) includeInProgress?: string;
  @IsOptional() @IsIn(['buyer', 'currency', 'country']) groupBy?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ReorderCreateDto {
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  /** Generate suggestions for every buyer entering its reorder window. */
  @IsOptional() @IsBoolean() all?: boolean;
}

export class SnoozeDto extends VersionDto {
  @IsDateString() until: string;
}

export class DismissDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
