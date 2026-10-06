import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { RegistrationStatus } from '@exportpro/types';

export class UpsertRegistrationDto {
  @IsEnum(RegistrationStatus, { message: 'Select a valid status.' })
  status: RegistrationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  number?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid issue date.' })
  issueDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid expiry date.' })
  expiryDate?: string;
}
