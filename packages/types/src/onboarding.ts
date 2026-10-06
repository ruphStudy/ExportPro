import {
  BusinessType,
  CertificationStatus,
  CountryRelation,
  ExportExperience,
  ExportGoal,
  InvestmentRange,
  LogisticsMode,
  OnboardingDocumentType,
  OnboardingStatus,
  ProductInterestType,
  RegistrationStatus,
  RegistrationType,
  RiskTolerance,
  ShipmentPreference,
  VerificationStatus,
} from "./enums";

/** The exporter-operating-model subset of BusinessType — see ARCHITECTURE.md "Exporter Type". */
export type ExporterType = Extract<BusinessType, "MANUFACTURER" | "MERCHANT_EXPORTER" | "TRADER">;

export interface ExporterProfileSummary {
  organizationId: string;
  exporterType: ExporterType | null;
  exportExperience: ExportExperience | null;
  riskTolerance: RiskTolerance | null;
  onboardingStatus: OnboardingStatus;
  currentStep: number;
  startedAt: string | null;
  completedAt: string | null;
  productCategories: string[];
  preferredIndustries: string[];
  investmentRange: InvestmentRange | null;
  desiredMarginMin: number | null;
  desiredMarginMax: number | null;
  shipmentPreference: ShipmentPreference | null;
  preferredLogistics: LogisticsMode[];
  exportGoals: ExportGoal[];
}

export interface UpdateExporterBusinessProfileRequest {
  exporterType?: ExporterType;
  exportExperience?: ExportExperience;
  riskTolerance?: RiskTolerance;
}

export interface UpdateExporterProductsRequest {
  productCategories?: string[];
}

export interface UpdateExporterPreferencesRequest {
  preferredIndustries?: string[];
  investmentRange?: InvestmentRange;
  desiredMarginMin?: number;
  desiredMarginMax?: number;
  shipmentPreference?: ShipmentPreference;
  preferredLogistics?: LogisticsMode[];
  exportGoals?: ExportGoal[];
}

export interface UpdateOnboardingProgressRequest {
  currentStep: number;
}

export interface ProductInterestSummary {
  id: string;
  name: string;
  category: string | null;
  interestType: ProductInterestType;
  notes: string | null;
  /** Sprint 5: saved product this interest was analyzed into, if any. */
  productId: string | null;
  analyzedAt: string | null;
  createdAt: string;
}

export interface CreateProductInterestRequest {
  name: string;
  category?: string;
  interestType?: ProductInterestType;
  notes?: string;
}

export type UpdateProductInterestRequest = Partial<CreateProductInterestRequest>;

export interface TargetCountrySummary {
  id: string;
  countryCode: string;
  relation: CountryRelation;
}

export interface SetTargetCountriesRequest {
  countryCode: string;
  relation?: CountryRelation;
}

export interface RegistrationSummary {
  id: string;
  type: RegistrationType;
  status: RegistrationStatus;
  number: string | null;
  verificationStatus: VerificationStatus;
  issueDate: string | null;
  expiryDate: string | null;
  documents: OnboardingDocumentSummary[];
}

export interface UpsertRegistrationRequest {
  status: RegistrationStatus;
  number?: string;
  issueDate?: string;
  expiryDate?: string;
}

export interface CertificationSummary {
  id: string;
  type: string;
  name: string;
  number: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: CertificationStatus;
  verificationStatus: VerificationStatus;
  notes: string | null;
  documents: OnboardingDocumentSummary[];
  createdAt: string;
}

export interface CreateCertificationRequest {
  type: string;
  name: string;
  number?: string;
  issuer?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
}

export type UpdateCertificationRequest = Partial<CreateCertificationRequest>;

export interface OnboardingDocumentSummary {
  id: string;
  documentType: OnboardingDocumentType;
  originalFilename: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export type ReadinessSectionKey =
  | "business_profile"
  | "products"
  | "markets"
  | "commercial_preferences"
  | "registrations"
  | "certifications";

export interface ReadinessSection {
  key: ReadinessSectionKey;
  label: string;
  score: number;
  maxScore: number;
  complete: string[];
  missing: string[];
}

export type RecommendationPriority = "CRITICAL" | "IMPORTANT" | "RECOMMENDED";

export interface MissingAction {
  priority: RecommendationPriority;
  message: string;
  /** Deep-link into the step/section that resolves this action. */
  section: ReadinessSectionKey;
}

export type ReadinessLevel = "GETTING_STARTED" | "FOUNDATION_IN_PROGRESS" | "EXPORT_READY" | "STRONG_SETUP";

export interface ReadinessResponse {
  score: number;
  level: ReadinessLevel;
  levelLabel: string;
  sections: ReadinessSection[];
  missingActions: MissingAction[];
}
