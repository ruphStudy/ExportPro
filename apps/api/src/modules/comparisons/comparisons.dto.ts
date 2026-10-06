import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ProductComparisonDto {
  @IsArray()
  @ArrayMinSize(2, { message: 'Select at least 2 products to compare.' })
  @ArrayMaxSize(5, { message: 'You can compare at most 5 products.' })
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  productIds: string[];
}

export class MarketComparisonDto {
  @IsString() @MaxLength(40) productId: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'Select at least 2 countries to compare.' })
  @ArrayMaxSize(5, { message: 'You can compare at most 5 countries.' })
  @Matches(/^[A-Za-z]{2}$/, {
    each: true,
    message: 'Use ISO alpha-2 country codes.',
  })
  countryCodes: string[];
}

export class RecommendationQueryDto {
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsIn(['LOW', 'MODERATE', 'HIGH']) risk?:
    'LOW' | 'MODERATE' | 'HIGH';
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  budgetFit?: boolean;
  @IsOptional()
  @IsIn([
    'bestOverall',
    'beginners',
    'withinBudget',
    'targetMarkets',
    'lowerRisk',
    'highGrowth',
  ])
  group?:
    | 'bestOverall'
    | 'beginners'
    | 'withinBudget'
    | 'targetMarkets'
    | 'lowerRisk'
    | 'highGrowth';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 12;
}
