import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveOpportunityDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
