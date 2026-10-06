import { IsEnum, IsOptional } from 'class-validator';
import {
  BusinessType,
  ExportExperience,
  ExporterType,
  RiskTolerance,
} from '@exportpro/types';

const EXPORTER_TYPES: ExporterType[] = [
  BusinessType.MANUFACTURER,
  BusinessType.MERCHANT_EXPORTER,
  BusinessType.TRADER,
];

export class UpdateBusinessProfileDto {
  @IsOptional()
  @IsEnum(EXPORTER_TYPES, {
    message: 'Select Manufacturer, Merchant Exporter, or Trader.',
  })
  exporterType?: ExporterType;

  @IsOptional()
  @IsEnum(ExportExperience, { message: 'Select a valid export experience.' })
  exportExperience?: ExportExperience;

  @IsOptional()
  @IsEnum(RiskTolerance, { message: 'Select a valid risk tolerance.' })
  riskTolerance?: RiskTolerance;
}
