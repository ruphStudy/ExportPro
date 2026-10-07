import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import type {
  ComparisonObjective,
  CostBasis,
  CostCategory,
  CostConfidence,
  CostingQuantityUnit,
  CostingStatus,
  CostSourceType,
  FreightQuoteType,
  Incoterm,
  PercentageBase,
  PricingMode,
  TransportMode,
} from '@exportpro/types';

/** Non-negative decimal string, max 14 integer digits and 6 decimals (no floats on the wire). */
const AMOUNT = /^\d{1,14}(\.\d{1,6})?$/;
const QTY = /^\d{1,14}(\.\d{1,4})?$/;
const CUR = /^[A-Z]{3}$/;

const CATEGORIES = [
  'PROCUREMENT',
  'PACKAGING',
  'INLAND_TRANSPORT',
  'INSPECTION',
  'CHA',
  'CUSTOMS',
  'PORT',
  'FREIGHT',
  'INSURANCE',
  'BANKING',
  'CERTIFICATES',
  'MISCELLANEOUS',
];
const BASES = [
  'FIXED',
  'PER_UNIT',
  'PER_KG',
  'PER_MT',
  'PER_CARTON',
  'PER_CONTAINER',
  'PERCENTAGE',
];
const UNITS = ['KG', 'MT', 'UNIT', 'CARTON', 'CONTAINER'];
const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF'];
const MODES = ['SEA', 'AIR', 'ROAD', 'RAIL', 'MULTIMODAL', 'OTHER'];

export class CostingListQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsIn(INCOTERMS) incoterm?: Incoterm;
  @IsOptional()
  @IsIn(['DRAFT', 'READY', 'LOCKED', 'ARCHIVED'])
  status?: CostingStatus;
  @IsOptional() @IsString() @MaxLength(40) createdBy?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class CreateCostingDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) productId?: string;
  @IsOptional() @IsString() @MaxLength(40) buyerCompanyId?: string;
  @IsOptional() @IsString() @MaxLength(40) crmLeadId?: string;
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'Use an ISO alpha-2 country code.' })
  destinationCountryCode?: string;
  @Matches(QTY, {
    message: 'Quantity must be a positive number (up to 4 decimals).',
  })
  quantity: string;
  @IsIn(UNITS) quantityUnit: CostingQuantityUnit;
  @IsOptional() @Matches(CUR) calculationCurrency?: string;
  @IsOptional() @Matches(CUR) quoteCurrency?: string;
  @IsOptional() @IsIn(INCOTERMS) incoterm?: Incoterm;
  @IsOptional() @IsString() @MaxLength(80) incotermPlace?: string;
}

export class UpdateCostingDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^[A-Z]{2}$/)
  destinationCountryCode?: string | null;
  @IsOptional() @Matches(CUR) calculationCurrency?: string;
  @IsOptional() @Matches(CUR) quoteCurrency?: string;
  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, {
    message: 'Thin-margin threshold must be between 0 and 99.99%.',
  })
  thinMarginPercent?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  productId?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  buyerCompanyId?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  crmLeadId?: string | null;
}

export class VersionDto {
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class LineDto {
  @IsOptional() @IsIn(CATEGORIES) category?: CostCategory;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) label?: string;
  /** null = not provided. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(AMOUNT, {
    message:
      'Amount must be a non-negative number (no negative costs; up to 6 decimals).',
  })
  amount?: string | null;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @IsIn(BASES) basis?: CostBasis;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['PROCUREMENT_VALUE', 'PRE_INSURANCE_COST'])
  percentageBase?: PercentageBase | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{1,2}(\.\d{1,4})?$/, {
    message: 'Wastage must be between 0 and 99.9999%.',
  })
  wastagePercent?: string | null;
  @IsOptional()
  @IsIn([
    'USER_ENTERED',
    'SUPPLIER_QUOTE',
    'FREIGHT_QUOTE',
    'SYSTEM_DERIVED',
    'PUBLIC_DATA',
    'IMPORTED',
    'DEMO',
  ])
  sourceType?: CostSourceType;
  @IsOptional()
  @IsIn(['CONFIRMED', 'ESTIMATE', 'UNKNOWN'])
  confidence?: CostConfidence;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['MANUAL_ESTIMATE', 'FORWARDER_QUOTE', 'PROVIDER_RATE', 'ACTUAL'])
  freightQuoteType?: FreightQuoteType | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  quoteReference?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  carrier?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(365)
  transitDays?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() quoteDate?:
    string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() validUntil?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  routeNotes?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  includeOverride?: boolean | null;
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class CreateLineDto extends LineDto {
  @IsString() @MaxLength(40) scenarioId: string;
  // `category` is required on create — enforced in the service (inherited field is optional for updates).
}

export class FxSelectionDto {
  @Matches(CUR) currency: string;
  @IsString() @MaxLength(40) snapshotId: string;
}

export class ScenarioDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional()
  @Matches(QTY, { message: 'Quantity must be a positive number.' })
  quantity?: string;
  @IsOptional() @IsIn(UNITS) quantityUnit?: CostingQuantityUnit;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(QTY) netWeightKg?:
    string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(QTY) cartonCount?:
    string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(QTY)
  containerCount?: string | null;
  @IsOptional() @IsIn(INCOTERMS) incoterm?: Incoterm;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  incotermPlace?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  originPort?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  destinationPort?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(MODES)
  transportMode?: TransportMode | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  supplierLabel?: string | null;
  @IsOptional()
  @IsIn(['MARGIN', 'MARKUP', 'TARGET_PRICE'])
  pricingMode?: PricingMode;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^-?\d{1,14}(\.\d{1,6})?$/, {
    message: 'Pricing value must be a number.',
  })
  pricingValue?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(AMOUNT)
  buyerTargetPrice?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FxSelectionDto)
  fx?: FxSelectionDto[];
  @IsOptional() @Type(() => Number) @IsInt() expectedRowVersion?: number;
}

export class CreateScenarioDto extends ScenarioDto {
  /** Clone source; defaults to the Base scenario. */
  @IsOptional() @IsString() @MaxLength(40) cloneFromScenarioId?: string;
}

export class CompareDto {
  @IsArray()
  @ArrayMinSize(2, { message: 'Select at least 2 scenarios.' })
  @ArrayMaxSize(5, { message: 'Compare at most 5 scenarios.' })
  @IsString({ each: true })
  scenarioIds: string[];
  @IsOptional()
  @IsIn([
    'LOWEST_COST',
    'HIGHEST_MARGIN',
    'HIGHEST_PROFIT',
    'CLOSEST_TO_TARGET',
  ])
  objective?: ComparisonObjective;
}

export class SensitivityQueryDto {
  @IsOptional()
  @Matches(/^-?\d{1,2}(\.\d{1,2})?(,-?\d{1,2}(\.\d{1,2})?){0,8}$/, {
    message: 'Shifts must be comma-separated percentages between -99 and 99.',
  })
  shifts?: string;
}

export class FxQueryDto {
  @IsOptional() @Matches(CUR) baseCurrency?: string;
  @IsOptional() @Matches(CUR) quoteCurrency?: string;
}

export class ManualFxDto {
  @Matches(CUR) baseCurrency: string;
  @Matches(CUR) quoteCurrency: string;
  @Matches(/^\d{1,10}(\.\d{1,10})?$/, {
    message: 'Rate must be a positive number.',
  })
  rate: string;
  @IsDateString() sourceDate: string;
  @IsOptional() @IsIn(['MANUAL', 'BANK_RATE']) sourceType?:
    'MANUAL' | 'BANK_RATE';
  @IsOptional() @IsString() @MaxLength(120) sourceLabel?: string;
}
