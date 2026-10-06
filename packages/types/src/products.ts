import {
  AmbiguityStatus,
  AnalysisSourceType,
  ClassificationSource,
  CodeSystem,
  ProductAnalysisStatus,
  ProductClassificationStatus,
  ProductInputType,
  TariffReferenceSourceType,
} from "./enums";
import type { PaginationMeta } from "./api";

/** Shown wherever a classification is presented — see ARCHITECTURE.md "Sprint 5". */
export const CLASSIFICATION_DISCLAIMER =
  "AI-assisted HS/ITC-HS suggestions are provided for analysis support. Final customs classification may depend on product composition, use, specifications, and applicable regulations.";

export const PLATFORM_CONFIRMATION_NOTE =
  "Confirming means \"use this classification for analysis in this platform\". It does not represent customs or government verification.";

// --- Code format helpers (shared so frontend detection matches backend validation) ---

export interface DetectedProductInput {
  inputType: ProductInputType;
  /** Digits only, for code inputs. */
  normalizedCode: string | null;
  /** Number of digits for code inputs: 2 = chapter, 4 = heading, 6 = subheading, 8 = ITC-HS tariff line. */
  codeLevel: number | null;
  /** True when the input looks like a code but is a partial level (2/4 digits) — never a complete classification. */
  isPartialCode: boolean;
  /** Set when input is code-like but not a valid length. */
  formatError: string | null;
}

const CODE_LIKE = /^[\d\s.\-]+$/;

export function normalizeTariffCode(raw: string): string {
  return raw.replace(/[\s.\-]/g, "");
}

/** Syntactic validity only — a well-formed code is NOT a legally correct classification. */
export function isValidCodeFormat(code: string, system: CodeSystem): boolean {
  if (!/^\d+$/.test(code)) return false;
  return system === "HS" ? [2, 4, 6].includes(code.length) : code.length === 8;
}

export function detectProductInput(raw: string): DetectedProductInput {
  const trimmed = raw.trim();
  if (trimmed && CODE_LIKE.test(trimmed) && /\d/.test(trimmed)) {
    const code = normalizeTariffCode(trimmed);
    if (code.length === 8) {
      return { inputType: "ITC_HS_CODE", normalizedCode: code, codeLevel: 8, isPartialCode: false, formatError: null };
    }
    if ([2, 4, 6].includes(code.length)) {
      return { inputType: "HS_CODE", normalizedCode: code, codeLevel: code.length, isPartialCode: code.length < 6, formatError: null };
    }
    return {
      inputType: "HS_CODE",
      normalizedCode: code,
      codeLevel: null,
      isPartialCode: false,
      formatError: "Codes should be 2, 4 or 6 digits (HS) or 8 digits (ITC-HS).",
    };
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const inputType: ProductInputType = words <= 6 && trimmed.length <= 60 ? "PRODUCT_NAME" : "DESCRIPTION";
  return { inputType, normalizedCode: null, codeLevel: null, isPartialCode: false, formatError: null };
}

export function codeSystemForLength(length: number): CodeSystem {
  return length === 8 ? "ITC_HS_INDIA" : "HS";
}

/** Display formatting, e.g. 090931 → 0909.31, 61091000 → 6109.10.00. */
export function formatTariffCode(code: string): string {
  if (code.length <= 4) return code;
  if (code.length <= 6) return `${code.slice(0, 4)}.${code.slice(4)}`;
  return `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6)}`;
}

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 75) return "HIGH";
  if (confidence >= 50) return "MEDIUM";
  return "LOW";
}

/** Below this, or whenever ambiguity is flagged, confirming requires an explicit acknowledgement. */
export const LOW_CONFIDENCE_THRESHOLD = 50;

// --- Analysis contracts -----------------------------------------------

export interface ProductAnalysisDetails {
  material?: string;
  intendedUse?: string;
  form?: string;
  manufacturingMethod?: string;
  composition?: string;
  endUseApplication?: string;
  additionalDetails?: string;
}

export interface ProductAnalysisInput {
  input: string;
  /** Optional override when auto-detection guesses wrong. */
  inputType?: ProductInputType;
  categoryCode?: string;
  details?: ProductAnalysisDetails;
  productInterestId?: string;
  opportunityId?: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  /** Suggested answers; the user may still type their own when `allowFreeText`. */
  options: string[];
  allowFreeText: boolean;
}

export interface ClarificationAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface ClarifyProductAnalysisRequest {
  answers: { questionId: string; answer: string }[];
}

export interface ProductAmbiguity {
  status: AmbiguityStatus;
  reason: string | null;
  clarifyingQuestions: ClarificationQuestion[];
}

export interface ProductIdentification {
  normalizedProductName: string;
  summary: string;
  /** Always a PRODUCT_CATEGORIES code — unmapped AI categories become OTHER. */
  categoryCode: string;
  material: string | null;
  form: string | null;
  intendedUse: string | null;
  composition: string | null;
  /** 0–100, product identification only — separate from each candidate's classification confidence. */
  confidence: number | null;
}

export interface ProductClassificationCandidate {
  id: string;
  code: string;
  codeSystem: CodeSystem;
  description: string;
  /** null for user-entered / manually selected codes — no AI confidence is ever attributed to them. */
  confidence: number | null;
  rank: number;
  reasoningSummary: string | null;
  source: ClassificationSource;
  inReferenceData: boolean;
  referenceDescription: string | null;
  selectedByUser: boolean;
  confirmedForPlatformUse: boolean;
}

export interface AnalysisProvenance {
  sourceType: AnalysisSourceType;
  provider: string;
  model: string | null;
  promptVersion: string;
  generatedAt: string;
  isDevelopmentResult: boolean;
}

export interface ProductAnalysisResponse {
  id: string;
  inputType: ProductInputType;
  rawInput: string;
  categoryHint: string | null;
  details: ProductAnalysisDetails;
  clarificationAnswers: ClarificationAnswer[];
  identification: ProductIdentification;
  ambiguity: ProductAmbiguity;
  candidates: ProductClassificationCandidate[];
  primaryCandidateId: string | null;
  selectedCandidateId: string | null;
  classificationStatus: ProductClassificationStatus;
  status: ProductAnalysisStatus;
  revision: number;
  provenance: AnalysisProvenance;
  linkedProduct: { id: string; displayName: string } | null;
  productInterestId: string | null;
  opportunityId: string | null;
  possibleDuplicates: ProductSummary[];
  /** True when an identical recent analysis was reopened instead of calling the provider again. */
  reused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecentProductAnalysis {
  id: string;
  rawInput: string;
  normalizedProductName: string;
  status: ProductAnalysisStatus;
  ambiguityStatus: AmbiguityStatus;
  primaryCode: string | null;
  createdAt: string;
}

export interface SelectClassificationRequest {
  candidateId?: string;
  /** Manual code chosen from reference search. */
  code?: string;
  codeSystem?: CodeSystem;
}

export type DuplicateResolution = "UPDATE_EXISTING" | "CREATE_NEW";

export interface ConfirmClassificationRequest {
  candidateId?: string;
  code?: string;
  codeSystem?: CodeSystem;
  /** Must be literally true — the explicit platform-use confirmation. */
  confirmation: true;
  displayName?: string;
  description?: string;
  categoryCode?: string;
  /** Required when the selected candidate is low-confidence or the analysis is ambiguous. */
  acknowledgeLowConfidence?: boolean;
  duplicateResolution?: DuplicateResolution;
  existingProductId?: string;
}

export interface ConfirmClassificationResponse {
  product: ProductDetail;
  created: boolean;
}

/** Returned in the 409 error details when likely duplicates exist and no resolution was given. */
export interface DuplicateConflictDetails {
  duplicates: ProductSummary[];
}

// --- Tariff reference ---------------------------------------------------

export interface HSReferenceItem {
  code: string;
  codeSystem: CodeSystem;
  level: number;
  description: string;
  parentCode: string | null;
  sourceType: TariffReferenceSourceType;
  sourceName: string;
}

export interface HSReferenceSearchResponse {
  items: HSReferenceItem[];
  meta: PaginationMeta;
}

export interface HSReferenceSearchQuery {
  q: string;
  codeSystem?: CodeSystem;
  page?: number;
  pageSize?: number;
}

// --- Saved organization products --------------------------------------

export interface ProductSummary {
  id: string;
  displayName: string;
  description: string | null;
  categoryCode: string | null;
  classificationCode: string;
  codeSystem: CodeSystem;
  /** 6-digit HS subheading (or shorter heading if that is all that was chosen). */
  hsCode: string;
  itcHsCode: string | null;
  classificationDescription: string;
  classificationStatus: ProductClassificationStatus;
  classificationSource: ClassificationSource;
  classificationConfidence: number | null;
  lowConfidenceAcknowledged: boolean;
  updatedAt: string;
}

export interface MarketAnalysisPathway {
  /** Opportunity-discovery search term that meaningfully matches this product, if any. */
  opportunitySearch: string | null;
  categoryCode: string | null;
  matchingOpportunityCount: number;
}

export interface ProductDetail extends ProductSummary {
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
  analysisId: string | null;
  productInterest: { id: string; name: string } | null;
  marketAnalysis: MarketAnalysisPathway;
  createdAt: string;
}

/** A saved product is the reusable organization entity — distinct from a temporary analysis. */
export type SavedProduct = ProductDetail;

export interface UpdateProductRequest {
  displayName?: string;
  description?: string | null;
  categoryCode?: string | null;
}

export interface ChangeProductClassificationRequest {
  code: string;
  codeSystem: CodeSystem;
  confirmation: true;
}

export interface ProductListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductListResponse {
  items: ProductSummary[];
  meta: PaginationMeta;
}
