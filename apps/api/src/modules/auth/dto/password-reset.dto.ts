import {
  IsEmail,
  IsString,
  Matches,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'NewPasswordsMatch' })
class NewPasswordsMatchConstraint implements ValidatorConstraintInterface {
  validate(confirmPassword: string, args: ValidationArguments) {
    const object = args.object as Record<string, unknown>;
    return confirmPassword === (object.password ?? object.newPassword);
  }
  defaultMessage() {
    return 'Passwords do not match.';
  }
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number.',
  })
  password: string;

  @IsString()
  @Validate(NewPasswordsMatchConstraint)
  confirmPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number.',
  })
  newPassword: string;

  @IsString()
  @Validate(NewPasswordsMatchConstraint)
  confirmNewPassword: string;
}
