import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CERTIFICATION_TYPE_OPTIONS,
  COUNTRIES,
  EXPORT_GOAL_LABELS,
  EXPORT_EXPERIENCE_LABELS,
  INVESTMENT_RANGE_LABELS,
  LOGISTICS_MODE_LABELS,
  PREFERRED_INDUSTRIES,
  PRODUCT_CATEGORIES,
  RISK_TOLERANCE_LABELS,
  SHIPMENT_PREFERENCE_LABELS,
} from '@exportpro/types';

function toOptions(labels: Record<string, string>) {
  return Object.entries(labels).map(([code, label]) => ({ code, label }));
}

/**
 * Static, code-defined reference lists (see ARCHITECTURE.md "Reference
 * Data") — no database table backs these; they change with a deploy.
 * Requires authentication like everything else, but no org-scoped
 * permission: it's the same list for every tenant.
 */
@ApiTags('reference')
@Controller('reference')
export class ReferenceController {
  @Get('countries')
  countries() {
    return COUNTRIES;
  }

  @Get('product-categories')
  productCategories() {
    return PRODUCT_CATEGORIES;
  }

  @Get('industries')
  industries() {
    return PREFERRED_INDUSTRIES;
  }

  @Get('export-goals')
  exportGoals() {
    return toOptions(EXPORT_GOAL_LABELS);
  }

  @Get('export-experience')
  exportExperience() {
    return toOptions(EXPORT_EXPERIENCE_LABELS);
  }

  @Get('investment-ranges')
  investmentRanges() {
    return toOptions(INVESTMENT_RANGE_LABELS);
  }

  @Get('shipment-preferences')
  shipmentPreferences() {
    return toOptions(SHIPMENT_PREFERENCE_LABELS);
  }

  @Get('logistics-modes')
  logisticsModes() {
    return toOptions(LOGISTICS_MODE_LABELS);
  }

  @Get('risk-tolerance')
  riskTolerance() {
    return Object.entries(RISK_TOLERANCE_LABELS).map(([code, value]) => ({
      code,
      ...value,
    }));
  }

  @Get('certification-types')
  certificationTypes() {
    return CERTIFICATION_TYPE_OPTIONS;
  }
}
