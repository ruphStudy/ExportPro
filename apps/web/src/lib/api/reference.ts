import type { ReferenceOption } from "@exportpro/types";
import { apiClient } from "../api-client";

export interface RiskToleranceOption {
  code: string;
  label: string;
  description: string;
}

export const referenceApi = {
  countries: () => apiClient.get<ReferenceOption[]>("/reference/countries"),
  productCategories: () => apiClient.get<ReferenceOption[]>("/reference/product-categories"),
  industries: () => apiClient.get<ReferenceOption[]>("/reference/industries"),
  exportGoals: () => apiClient.get<ReferenceOption[]>("/reference/export-goals"),
  exportExperience: () => apiClient.get<ReferenceOption[]>("/reference/export-experience"),
  investmentRanges: () => apiClient.get<ReferenceOption[]>("/reference/investment-ranges"),
  shipmentPreferences: () => apiClient.get<ReferenceOption[]>("/reference/shipment-preferences"),
  logisticsModes: () => apiClient.get<ReferenceOption[]>("/reference/logistics-modes"),
  riskTolerance: () => apiClient.get<RiskToleranceOption[]>("/reference/risk-tolerance"),
  certificationTypes: () => apiClient.get<ReferenceOption[]>("/reference/certification-types"),
};
