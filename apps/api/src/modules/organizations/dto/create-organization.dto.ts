import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BusinessType, TradeDirection } from '@exportpro/types';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2, { message: 'Company name must be at least 2 characters.' })
  @MaxLength(200)
  name: string;

  @IsEnum(BusinessType, { message: 'Select a valid business type.' })
  businessType: BusinessType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  industry?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TradeDirection, { each: true })
  tradeDirections?: TradeDirection[];
}
