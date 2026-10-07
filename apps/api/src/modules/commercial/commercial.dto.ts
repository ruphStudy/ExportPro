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
import { RFQ_INCOTERMS } from '@exportpro/types';

const nullable = () => ValidateIf((_, v) => v !== null);
const QTY = /^\d{1,14}(\.\d{1,4})?$/;
const PRICE = /^\d{1,14}(\.\d{1,6})?$/;
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const CUR = /^[A-Z]{3}$/;
const ISO2 = /^[A-Z]{2}$/;

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @IsString() @MaxLength(40) inquiryId?: string;
  @IsOptional() @IsString() @MaxLength(40) costingId?: string;
  @IsOptional() @IsString() @MaxLength(40) quotationId?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @Matches(ISO2) country?: string;
  @IsOptional() @IsString() @MaxLength(40) createdBy?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class CreateQuotationDto {
  @IsOptional() @IsString() @MaxLength(40) inquiryId?: string;
  @IsOptional() @IsString() @MaxLength(40) quotationRequestId?: string;
  @IsOptional() @IsString() @MaxLength(40) costingId?: string;
  @IsOptional() @IsString() @MaxLength(40) costingScenarioId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(160) buyerName?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  /** Required to quote from a DRAFT (unstable) costing. */
  @IsOptional() @IsBoolean() acknowledgeDraftCosting?: boolean;
}

export class QuotationItemDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) inquiryItemId?:
    string | null;
  @IsString() @MinLength(1) @MaxLength(300) description: string;
  @IsOptional()
  @nullable()
  @Matches(/^\d{4,10}$/, { message: 'HS code must be 4–10 digits.' })
  hsCode?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) specification?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) packaging?:
    string | null;
  @Matches(QTY, {
    message: 'Quantity must be a positive number (up to 4 decimals).',
  })
  quantity: string;
  @IsString() @MinLength(1) @MaxLength(20) unit: string;
  @IsOptional()
  @nullable()
  @Matches(PRICE, { message: 'Unit price must be a non-negative number.' })
  unitPrice?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) deliveryNotes?:
    string | null;
  @IsOptional() @nullable() @Matches(ISO2) countryOfOrigin?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) costingId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) costingScenarioId?:
    string | null;
  /** Re-take the unit price from the linked costing snapshot. */
  @IsOptional() @IsBoolean() applyCostingPrice?: boolean;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  overrideReason?: string;
}

export class UpdateQuotationDto extends VersionDto {
  @IsOptional() @nullable() @IsString() @MaxLength(40) buyerCompanyId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) buyerName?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) buyerContactId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) crmLeadId?:
    string | null;
  @IsOptional() @Matches(CUR) currency?: string;
  /** Changing currency clears prices — they must be re-entered or re-applied from a costing in that currency. */
  @IsOptional() @IsBoolean() clearPricesOnCurrencyChange?: boolean;
  @IsOptional() @nullable() @IsDateString() issueDate?: string | null;
  @IsOptional() @nullable() @IsDateString() validUntil?: string | null;
  @IsOptional() @nullable() @IsIn([...RFQ_INCOTERMS]) incoterm?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) incotermPlace?:
    string | null;
  @IsOptional() @nullable() @Matches(ISO2) originCountry?: string | null;
  @IsOptional() @nullable() @Matches(ISO2) destinationCountry?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) destinationPort?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) paymentTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) deliveryTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) leadTime?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) shipmentWindow?:
    string | null;
  @IsOptional() @nullable() @IsBoolean() partialShipment?: boolean | null;
  @IsOptional() @nullable() @IsBoolean() transshipment?: boolean | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) buyerNotes?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) internalNotes?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20000) termsAndConditions?:
    string | null;
  @IsOptional() @Matches(MONEY) additionalCharges?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(80) chargesLabel?:
    string | null;
  @IsOptional() @Matches(MONEY) discount?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];
}

export class ReasonDto extends VersionDto {
  @IsString()
  @MinLength(3, { message: 'A reason is required.' })
  @MaxLength(1000)
  reason: string;
}

export class OptionalReasonDto extends VersionDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class AcceptQuotationDto extends VersionDto {
  @IsIn(['MANUAL', 'EMAIL_REPLY', 'PO_RECEIVED', 'OTHER']) source:
    'MANUAL' | 'EMAIL_REPLY' | 'PO_RECEIVED' | 'OTHER';
  @IsOptional() @IsString() @MaxLength(120) buyerReference?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class PiItemDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(40) quotationItemId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsString() @MinLength(1) @MaxLength(300) description: string;
  @IsOptional() @nullable() @Matches(/^\d{4,10}$/) hsCode?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) specification?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) packaging?:
    string | null;
  @Matches(QTY) quantity: string;
  @IsString() @MinLength(1) @MaxLength(20) unit: string;
  @Matches(PRICE) unitPrice: string;
}

export class CreatePiDto {
  @IsOptional() @IsString() @MaxLength(40) quotationId?: string;
  /** Manager override to create a PI from a quotation that is not accepted. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  overrideReason?: string;
  /** Manual PI (no quotation). */
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(160) buyerName?: string;
  @IsOptional() @Matches(CUR) currency?: string;
}

export class UpdatePiDto extends VersionDto {
  @IsOptional() @nullable() @IsDateString() issueDate?: string | null;
  @IsOptional() @nullable() @IsDateString() validUntil?: string | null;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @nullable() @IsIn([...RFQ_INCOTERMS]) incoterm?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) incotermPlace?:
    string | null;
  @IsOptional() @nullable() @Matches(ISO2) destinationCountry?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) destinationPort?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) paymentTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) deliveryTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) buyerNotes?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) internalNotes?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20000) terms?: string | null;
  @IsOptional() @Matches(MONEY) additionalCharges?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(80) chargesLabel?:
    string | null;
  @IsOptional() @Matches(MONEY) discount?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PiItemDto)
  items?: PiItemDto[];
}

export class PoItemDto {
  @IsOptional() @nullable() @IsString() @MaxLength(40) quotationItemId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) productId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) buyerProductCode?:
    string | null;
  @IsString() @MinLength(1) @MaxLength(300) description: string;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) specification?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(500) packaging?:
    string | null;
  @Matches(QTY) quantity: string;
  @IsString() @MinLength(1) @MaxLength(20) unit: string;
  @Matches(PRICE) unitPrice: string;
  @IsOptional() @nullable() @Matches(MONEY) totalPrice?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(60) deliveryDate?:
    string | null;
}

export class PoHeaderDto extends VersionDto {
  @IsOptional() @nullable() @IsString() @MaxLength(40) quotationId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) proformaInvoiceId?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) crmLeadId?:
    string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) poNumber?: string;
  @IsOptional() @IsDateString() poDate?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @nullable() @IsIn([...RFQ_INCOTERMS]) incoterm?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(80) incotermPlace?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) paymentTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(1000) deliveryTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(200) destination?:
    string | null;
  @IsOptional() @nullable() @Matches(MONEY) totalAmount?: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(3000) notes?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PoItemDto)
  items?: PoItemDto[];
}

/** poNumber, poDate and currency are required on create (checked in the service). */
export class CreatePoDto extends PoHeaderDto {
  @IsString() @MaxLength(40) buyerCompanyId: string;
}

export class UploadPoDto {
  @IsString() @MaxLength(40) buyerCompanyId: string;
  @IsString() @MinLength(1) @MaxLength(80) poNumber: string;
  @IsDateString() poDate: string;
  @Matches(CUR) currency: string;
  @IsOptional() @IsString() @MaxLength(40) quotationId?: string;
  @IsOptional() @IsString() @MaxLength(40) proformaInvoiceId?: string;
}

export class ResolveDiscrepancyDto {
  @IsIn(['ACCEPTED_DIFFERENCE', 'CORRECTED', 'RESOLVED']) status:
    'ACCEPTED_DIFFERENCE' | 'CORRECTED' | 'RESOLVED';
  @IsString()
  @MinLength(3, { message: 'Add a resolution note.' })
  @MaxLength(1000)
  note: string;
}

export class AcceptPoDto extends VersionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason?: string;
}

class BankDetailsDto {
  @IsOptional() @nullable() @IsString() @MaxLength(120) bankName: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(160) beneficiary:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(40) accountNumber:
    string | null;
  @IsOptional()
  @nullable()
  @Matches(/^[A-Z0-9]{8,11}$/, {
    message: 'SWIFT/BIC must be 8 or 11 characters.',
  })
  swift: string | null;
  @IsOptional()
  @nullable()
  @Matches(/^[A-Z0-9 ]{10,40}$/, { message: 'IBAN looks invalid.' })
  iban: string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) bankAddress:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(300) intermediary:
    string | null;
}

export class UpdateSettingsDto {
  @IsOptional()
  @Matches(/^[A-Z0-9]{1,8}$/, { message: 'Prefix: 1–8 letters/digits.' })
  quotationPrefix?: string;
  @IsOptional()
  @Matches(/^[A-Z0-9]{1,8}$/, { message: 'Prefix: 1–8 letters/digits.' })
  piPrefix?: string;
  @IsOptional() @IsBoolean() yearlyReset?: boolean;
  @IsOptional() @IsInt() @Min(2) @Max(4) unitPricePrecision?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) defaultValidityDays?: number;
  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/)
  quantityTolerancePercent?: string;
  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/)
  priceTolerancePercent?: string;
  @IsOptional() @nullable() @IsString() @MaxLength(20000) quotationTerms?:
    string | null;
  @IsOptional() @nullable() @IsString() @MaxLength(20000) piTerms?:
    string | null;
  @IsOptional()
  @nullable()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto | null;
}
