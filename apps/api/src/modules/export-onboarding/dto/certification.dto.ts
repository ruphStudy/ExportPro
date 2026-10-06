import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCertificationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type: string;

  @IsString()
  @MinLength(1, { message: 'Enter a certificate name.' })
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuer?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid issue date.' })
  issueDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid expiry date.' })
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateCertificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuer?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid issue date.' })
  issueDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid expiry date.' })
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
