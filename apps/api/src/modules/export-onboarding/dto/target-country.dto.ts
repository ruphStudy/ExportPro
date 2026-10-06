import { IsEnum, IsIn } from 'class-validator';
import { COUNTRIES, CountryRelation } from '@exportpro/types';

const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export class SetTargetCountryDto {
  @IsIn(COUNTRY_CODES, { message: 'Select a valid country.' })
  countryCode: string;

  @IsEnum(CountryRelation)
  relation: CountryRelation;
}
