import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PRODUCT_CATEGORIES, ProductInterestType } from '@exportpro/types';

const CATEGORY_CODES = PRODUCT_CATEGORIES.map((c) => c.code);

export class CreateProductInterestDto {
  @IsString()
  @MinLength(1, { message: 'Enter a product name.' })
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsIn(CATEGORY_CODES, { message: 'Unknown product category.' })
  category?: string;

  @IsOptional()
  @IsEnum(ProductInterestType)
  interestType?: ProductInterestType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateProductInterestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(CATEGORY_CODES, { message: 'Unknown product category.' })
  category?: string;

  @IsOptional()
  @IsEnum(ProductInterestType)
  interestType?: ProductInterestType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
