import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  currentStep: number;
}
