import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TRADE_DOCUMENT_TYPES } from '@exportpro/types';

export class ExtractDto {
  /** Re-extract even when a result exists for this version/provider/schema (creates a new extraction version). */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class ConfirmExtractionDto {
  /** Every extracted header field must be present (value, corrected value, or null to clear). */
  @IsObject() fields: Record<string, string | null>;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  unknownFields?: string[];
  @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) items: Record<
    string,
    string | null
  >[];
  @IsOptional() @IsIn(TRADE_DOCUMENT_TYPES) confirmedDocumentType?: string;
  @IsOptional() @IsBoolean() confirmTypeChange?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Manual structured entry when extraction is unavailable or failed. */
export class ManualExtractionDto extends ConfirmExtractionDto {}

export class ResolveFindingDto {
  @IsIn(['ACCEPTED_DIFFERENCE', 'CORRECTED', 'FALSE_POSITIVE', 'RESOLVED'])
  status: 'ACCEPTED_DIFFERENCE' | 'CORRECTED' | 'FALSE_POSITIVE' | 'RESOLVED';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

export class SignOffDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Manager-only: sign off despite unresolved critical findings (audited). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason?: string;
}

export class ValidationReasonDto {
  @IsString()
  @MinLength(3, { message: 'A reason is required.' })
  @MaxLength(1000)
  reason: string;
}

export class RunsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}
