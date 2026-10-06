import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SearchOpportunitiesDto } from './search-query.dto';

export class CreateSavedSearchDto {
  @IsString()
  @MinLength(1, { message: 'Enter a name for this search.' })
  @MaxLength(100)
  name: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SearchOpportunitiesDto)
  query: SearchOpportunitiesDto;
}

export class UpdateSavedSearchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SearchOpportunitiesDto)
  query?: SearchOpportunitiesDto;
}
