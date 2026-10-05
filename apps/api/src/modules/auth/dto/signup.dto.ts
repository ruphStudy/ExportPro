import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'PasswordsMatch' })
class PasswordsMatchConstraint implements ValidatorConstraintInterface {
  validate(confirmPassword: string, args: ValidationArguments) {
    const object = args.object as Record<string, unknown>;
    return confirmPassword === object.password;
  }
  defaultMessage() {
    return 'Passwords do not match.';
  }
}

export class SignupDto {
  @IsString()
  @MinLength(1, { message: 'First name is required.' })
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1, { message: 'Last name is required.' })
  @MaxLength(100)
  lastName: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number.',
  })
  password: string;

  @IsString()
  @Validate(PasswordsMatchConstraint)
  confirmPassword: string;
}
