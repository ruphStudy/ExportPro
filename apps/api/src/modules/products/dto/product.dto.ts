import { Type } from 'class-transformer';
import {
  Equals,
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
} from 'class-validator';
import { CodeSystem } from '@exportpro/types';

export class ListProductsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) displayName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  categoryCode?: string | null;
}

export class ChangeClassificationDto {
  @IsString()
  @Matches(/^[\d\s.]{2,12}$/, { message: 'Enter a numeric HS / ITC-HS code.' })
  code: string;

  @IsIn(['HS', 'ITC_HS_INDIA'])
  codeSystem: CodeSystem;

  @Equals(true, { message: 'Explicit confirmation is required.' })
  confirmation: true;
}
