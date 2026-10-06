import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  BuyerSort,
  BuyerSourceFilter,
  BuyerType,
  CompanySize,
  ImportFrequency,
  VerifiedContactFilter,
} from '@exportpro/types';

const BUYER_TYPES = [
  'IMPORTER',
  'DISTRIBUTOR',
  'WHOLESALER',
  'RETAILER',
  'MANUFACTURER',
  'AGENT',
  'OTHER',
  'UNKNOWN',
];
const SIZES = ['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE', 'UNKNOWN'];
const FREQS = [
  'OCCASIONAL',
  'REGULAR',
  'FREQUENT',
  'HIGH_FREQUENCY',
  'UNKNOWN',
];

/** Product/market context shared by search, detail, save and CRM handoff. */
export class BuyerContextDto {
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional()
  @Matches(/^\d{2}(\d{2}){0,3}$/, {
    message: 'HS code must be 2, 4, 6 or 8 digits.',
  })
  hsCode?: string;
  @IsOptional() @IsString() @MaxLength(80) productName?: string;
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'Use an ISO alpha-2 country code.' })
  country?: string;
}

export class BuyerSearchDto extends BuyerContextDto {
  @IsOptional() @IsIn(BUYER_TYPES) buyerType?: BuyerType;
  @IsOptional() @IsIn(SIZES) companySize?: CompanySize;
  @IsOptional() @IsIn(FREQS) importFrequency?: ImportFrequency;
  @IsOptional()
  @IsIn(['ANY', 'VERIFIED', 'HAS_CONTACT', 'NO_CONTACT'])
  verifiedContact?: VerifiedContactFilter;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minMatchScore?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxRisk?: number;
  @IsOptional()
  @IsIn(['DEMO', 'USER_PROVIDED', 'REAL'])
  source?: BuyerSourceFilter;
  @IsOptional()
  @IsIn([
    'BEST_MATCH',
    'LOWEST_RISK',
    'MOST_ACTIVE',
    'CONTACT_CONFIDENCE',
    'RECENTLY_VERIFIED',
  ])
  sort?: BuyerSort;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class SavedBuyersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class SaveBuyerDto {
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
}

export class BuyerNotesDto {
  @IsString()
  @MaxLength(5000, { message: 'Notes can be at most 5,000 characters.' })
  notes: string;
}

export class AddToCrmDto {
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(200) context?: string;
}

export class CreateManualBuyerDto {
  @IsString()
  @MinLength(2, { message: 'Enter the company name.' })
  @MaxLength(160)
  name: string;
  @Matches(/^[A-Z]{2}$/, { message: 'Select a country.' }) countryCode: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  @IsOptional() @IsIn(BUYER_TYPES) buyerType?: BuyerType;
  @IsOptional() @IsString() @MaxLength(60) businessCategory?: string;
  @IsOptional() @IsString() @MaxLength(254) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(120) contactRole?: string;
  @IsOptional()
  @Matches(/^\d{2}(\d{2}){0,3}$/, {
    message: 'HS code must be 2, 4, 6 or 8 digits.',
  })
  hsCode?: string;
  @IsOptional() @IsString() @MaxLength(120) productName?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}
