import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'Password is required.' })
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
