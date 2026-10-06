import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

export class IngestDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  datasets?: string[];
}

export class UpdateSourceDto {
  @IsBoolean() enabled: boolean;
}

export class FactQueryDto {
  @IsOptional() @IsIn(['EXPORT', 'IMPORT']) tradeDirection?:
    'EXPORT' | 'IMPORT';
  @IsOptional() @Matches(/^[\d.\s]{2,12}$/) hsCode?: string;
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) reporter?: string;
  @IsOptional() @Matches(/^([A-Za-z]{2}|world|WORLD)$/) partner?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1988)
  @Max(2100)
  year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsString() @MaxLength(12) port?: string;
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) state?: string;
  @IsOptional() @IsString() @MaxLength(40) sourceId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}

export class RunQueryDto {
  @IsOptional() @IsString() @MaxLength(40) sourceId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class IssueQueryDto {
  @IsOptional() @IsString() @MaxLength(40) sourceId?: string;
  @IsOptional() @IsString() @MaxLength(40) kind?: string;
  @IsOptional() @IsIn(['REJECTED', 'UNRESOLVED', 'WARNING']) severity?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}
