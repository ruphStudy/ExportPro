import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BusinessType, TradeDirection } from '@exportpro/types';

/** An empty string from a cleared form field means "clear this", not "an invalid URL/email" — normalize it to null before the format validators run. */
const emptyToNull = Transform(({ value }: { value: unknown }) =>
  value === '' ? null : value,
);

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  industry?: string;

  @emptyToNull
  @IsOptional()
  @IsUrl({}, { message: 'Enter a valid website URL.' })
  @MaxLength(255)
  website?: string | null;

  @emptyToNull
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid business email.' })
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultCurrency?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TradeDirection, { each: true })
  tradeDirections?: TradeDirection[];
}
