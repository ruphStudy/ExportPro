import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ExportGoal,
  InvestmentRange,
  LogisticsMode,
  PREFERRED_INDUSTRIES,
  ShipmentPreference,
} from '@exportpro/types';

const INDUSTRY_CODES = PREFERRED_INDUSTRIES.map((i) => i.code);

export class UpdatePreferencesDto {
  @IsOptional()
  @IsArray()
  @IsIn(INDUSTRY_CODES, { each: true, message: 'Unknown industry.' })
  preferredIndustries?: string[];

  @IsOptional()
  @IsEnum(InvestmentRange, { message: 'Select a valid investment range.' })
  investmentRange?: InvestmentRange;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  desiredMarginMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  @ValidateIf((o: UpdatePreferencesDto) => o.desiredMarginMin !== undefined)
  desiredMarginMax?: number;

  @IsOptional()
  @IsEnum(ShipmentPreference, {
    message: 'Select a valid shipment preference.',
  })
  shipmentPreference?: ShipmentPreference;

  @IsOptional()
  @IsArray()
  @IsEnum(LogisticsMode, {
    each: true,
    message: 'Select valid logistics modes.',
  })
  preferredLogistics?: LogisticsMode[];

  @IsOptional()
  @IsArray()
  @IsEnum(ExportGoal, { each: true, message: 'Select valid export goals.' })
  exportGoals?: ExportGoal[];
}
