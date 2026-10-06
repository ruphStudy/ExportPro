import { IsArray, IsIn, IsOptional } from 'class-validator';
import { PRODUCT_CATEGORIES } from '@exportpro/types';

const CATEGORY_CODES = PRODUCT_CATEGORIES.map((c) => c.code);

export class UpdateProductsDto {
  @IsOptional()
  @IsArray()
  @IsIn(CATEGORY_CODES, { each: true, message: 'Unknown product category.' })
  productCategories?: string[];
}
