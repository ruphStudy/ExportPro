import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  CompetitionLevel,
  ComplianceDifficulty,
  InvestmentRange,
  OpportunitySort,
  PRODUCT_CATEGORIES,
  COUNTRIES,
} from '@exportpro/types';

const CATEGORY_CODES = PRODUCT_CATEGORIES.map((c) => c.code);
const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export class SearchOpportunitiesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(CATEGORY_CODES)
  category?: string;

  @IsOptional()
  @IsIn(COUNTRY_CODES)
  country?: string;

  @IsOptional()
  @IsEnum(InvestmentRange)
  budget?: InvestmentRange;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minMarginScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minGrowthScore?: number;

  @IsOptional()
  @IsEnum(CompetitionLevel)
  competitionLevel?: CompetitionLevel;

  @IsOptional()
  @IsEnum(ComplianceDifficulty)
  complianceDifficulty?: ComplianceDifficulty;

  @IsOptional()
  @IsEnum(OpportunitySort)
  sort?: OpportunitySort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}
