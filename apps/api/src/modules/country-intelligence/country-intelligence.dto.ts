import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ProductMarketsQueryDto {
  @IsOptional() @IsString() @MaxLength(40) region?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;
  @IsOptional()
  @IsIn([
    'OPPORTUNITY',
    'DEMAND',
    'GROWTH',
    'TARIFF',
    'COMPETITION',
    'LOGISTICS',
    'RISK',
  ])
  sort?:
    | 'OPPORTUNITY'
    | 'DEMAND'
    | 'GROWTH'
    | 'TARIFF'
    | 'COMPETITION'
    | 'LOGISTICS'
    | 'RISK';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}

export class CountryListQueryDto {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @IsString() @MaxLength(40) region?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize?: number = 24;
}

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}
