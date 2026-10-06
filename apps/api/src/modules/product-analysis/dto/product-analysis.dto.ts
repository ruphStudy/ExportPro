import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CodeSystem, ProductInputType } from '@exportpro/types';

const INPUT_TYPES: ProductInputType[] = [
  'PRODUCT_NAME',
  'HS_CODE',
  'ITC_HS_CODE',
  'DESCRIPTION',
];
const CODE_SYSTEMS: CodeSystem[] = ['HS', 'ITC_HS_INDIA'];

export class ProductAnalysisDetailsDto {
  @IsOptional() @IsString() @MaxLength(200) material?: string;
  @IsOptional() @IsString() @MaxLength(300) intendedUse?: string;
  @IsOptional() @IsString() @MaxLength(200) form?: string;
  @IsOptional() @IsString() @MaxLength(200) manufacturingMethod?: string;
  @IsOptional() @IsString() @MaxLength(300) composition?: string;
  @IsOptional() @IsString() @MaxLength(300) endUseApplication?: string;
  @IsOptional() @IsString() @MaxLength(1000) additionalDetails?: string;
}

export class CreateProductAnalysisDto {
  @IsString()
  @MinLength(2, { message: 'Enter a product name, code or description.' })
  @MaxLength(1000)
  input: string;

  @IsOptional()
  @IsIn(INPUT_TYPES)
  inputType?: ProductInputType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  categoryCode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductAnalysisDetailsDto)
  details?: ProductAnalysisDetailsDto;

  @IsOptional() @IsString() @MaxLength(40) productInterestId?: string;
  @IsOptional() @IsString() @MaxLength(40) opportunityId?: string;
}

export class ClarificationAnswerDto {
  @IsString()
  @Matches(/^[a-z0-9_]{1,40}$/)
  questionId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  answer: string;
}

export class ClarifyProductAnalysisDto {
  @ValidateNested({ each: true })
  @Type(() => ClarificationAnswerDto)
  @ArrayMinSize(1, { message: 'Answer at least one question.' })
  @ArrayMaxSize(10)
  answers: ClarificationAnswerDto[];
}

export class SelectClassificationDto {
  @IsOptional() @IsString() @MaxLength(40) candidateId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[\d\s.]{2,12}$/, { message: 'Enter a numeric HS / ITC-HS code.' })
  code?: string;

  @IsOptional()
  @IsIn(CODE_SYSTEMS)
  codeSystem?: CodeSystem;
}

export class ConfirmClassificationDto extends SelectClassificationDto {
  @Equals(true, { message: 'Explicit confirmation is required.' })
  confirmation: true;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) displayName?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) categoryCode?: string;
  @IsOptional() @IsBoolean() acknowledgeLowConfidence?: boolean;

  @IsOptional()
  @IsIn(['UPDATE_EXISTING', 'CREATE_NEW'])
  duplicateResolution?: 'UPDATE_EXISTING' | 'CREATE_NEW';

  @IsOptional() @IsString() @MaxLength(40) existingProductId?: string;
}

export class TariffSearchQueryDto {
  @IsString()
  @MinLength(2, { message: 'Enter at least 2 characters.' })
  @MaxLength(100)
  q: string;

  @IsOptional()
  @IsIn(CODE_SYSTEMS)
  codeSystem?: CodeSystem;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}
