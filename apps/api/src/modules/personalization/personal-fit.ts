import {
  FOOD_RELATED_CATEGORY_CODES,
  INVESTMENT_RANGE_LABELS,
  PRODUCT_CATEGORIES,
  type IntelligenceLevel,
  type InvestmentRange,
  type MissingAction,
  type PersonalFitComponent,
  type PersonalFitComponentKey,
  type PersonalFitResult,
  type RecommendationProfile,
  type RecommendationReason,
  type RecommendationWarning,
} from '@exportpro/types';

/** Personal-fit weights (sum 100) — documented in the Sprint 8 report. */
export const PERSONAL_FIT_WEIGHTS: Record<PersonalFitComponentKey, number> = {
  budget: 20,
  experience: 15,
  category: 15,
  targetCountry: 10,
  risk: 15,
  logistics: 10,
  margin: 10,
  readiness: 5,
};

export const PERSONAL_FIT_LABELS: Record<PersonalFitComponentKey, string> = {
  budget: 'Budget fit',
  experience: 'Experience fit',
  category: 'Category / product fit',
  targetCountry: 'Target-market fit',
  risk: 'Risk-tolerance fit',
  logistics: 'Logistics fit',
  margin: 'Margin fit',
  readiness: 'Readiness / registration fit',
};

/** Recommendation ranking only — base scores are untouched. */
export const RECOMMENDATION_BASE_WEIGHT = 0.7;
export const RECOMMENDATION_FIT_WEIGHT = 0.3;

const INVESTMENT_ORDER: InvestmentRange[] = [
  'UNDER_1L',
  'L1_5',
  'L5_10',
  'L10_25',
  'L25_50',
  'L50_1CR',
  'ABOVE_1CR',
];
/** Minimum investment band broadly compatible with each capital-intensity level (compatibility bands, not capital estimates). */
const CAPITAL_MIN_BAND: Record<IntelligenceLevel, number> = {
  LOW: 0,
  MODERATE: 2,
  HIGH: 4,
};

export interface FitProfile {
  hasProfile: boolean;
  investmentRange: InvestmentRange | null;
  exportExperience: string | null;
  riskTolerance: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | null;
  businessType: string | null;
  stateCode: string | null;
  stateName: string | null;
  productCategories: string[];
  interestCategories: string[];
  targets: Map<string, 'CURRENT' | 'INTERESTED'>;
  preferredLogistics: string[];
  shipmentPreference: string | null;
  desiredMarginMin: number | null;
  registrations: Map<string, string>;
  readinessScore: number | null;
  readinessActions: MissingAction[];
}

export interface FitAttributes {
  categoryCode: string;
  capitalIntensity: IntelligenceLevel;
  complianceEase: number;
  logisticsEase: number;
  marginPotential: number;
  growthScore: number;
  /** Sprint 6 supply-risk signal (higher = more resilient). */
  supplyResilience: number | null;
  ecosystemStateCodes: string[];
  topDestinations: string[];
  /** Null for product-only (no country) fit. */
  countryCode: string | null;
  countryRiskScore: number | null;
  marketEntryEase: number | null;
  routeComplexity: IntelligenceLevel | null;
  airSuitable: boolean | null;
}

const isNovice = (e: string | null) => e === 'NONE' || e === 'LESS_THAN_1_YEAR';
const isExperienced = (e: string | null) =>
  e === 'THREE_TO_FIVE_YEARS' ||
  e === 'FIVE_TO_TEN_YEARS' ||
  e === 'TEN_PLUS_YEARS';
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Deterministic 0–100 personal fit. Consumes existing Sprint 3 profile and
 * Sprint 6/7 signals; never changes any base score.
 */
export function computePersonalFit(
  p: FitProfile,
  a: FitAttributes,
): PersonalFitResult {
  const reasons: RecommendationReason[] = [];
  const cautions: RecommendationWarning[] = [];
  const components: PersonalFitComponent[] = [];
  const add = (
    key: PersonalFitComponentKey,
    points: number,
    inputAvailable: boolean,
  ) =>
    components.push({
      key,
      label: PERSONAL_FIT_LABELS[key],
      points: round1(Math.max(0, Math.min(PERSONAL_FIT_WEIGHTS[key], points))),
      max: PERSONAL_FIT_WEIGHTS[key],
      inputAvailable,
    });
  const categoryLabel =
    PRODUCT_CATEGORIES.find((c) => c.code === a.categoryCode)?.label ??
    a.categoryCode;

  // Budget (20): investment range vs capital-intensity compatibility band.
  if (p.investmentRange) {
    const gap =
      CAPITAL_MIN_BAND[a.capitalIntensity] -
      INVESTMENT_ORDER.indexOf(p.investmentRange);
    let pts = gap <= 0 ? 20 : gap === 1 ? 11 : 3;
    if (
      a.capitalIntensity === 'HIGH' &&
      (p.shipmentPreference === 'SAMPLES_ONLY' ||
        p.shipmentPreference === 'COURIER_PARCEL')
    )
      pts -= 3;
    add('budget', pts, true);
    if (gap <= 0)
      reasons.push({
        text: `Fits your ${INVESTMENT_RANGE_LABELS[p.investmentRange]} investment range`,
        component: 'budget',
      });
    else
      cautions.push({
        text: `${titleCase(a.capitalIntensity)} capital intensity may exceed your ${INVESTMENT_RANGE_LABELS[p.investmentRange]} range`,
        component: 'budget',
      });
  } else add('budget', 10, false);

  // Experience (15): newer exporters favour easier compliance/logistics/entry and lower capital.
  const capitalEase = { LOW: 80, MODERATE: 55, HIGH: 30 }[a.capitalIntensity];
  const ease =
    avg([a.complianceEase, a.logisticsEase, a.marketEntryEase, capitalEase]) ??
    50;
  if (p.exportExperience) {
    let pts: number;
    if (isNovice(p.exportExperience)) {
      pts = (15 * ease) / 100;
      if (ease >= 65)
        reasons.push({
          text: 'Easier compliance, logistics and entry suit a newer exporter',
          component: 'experience',
        });
      if (ease < 45)
        cautions.push({
          text: 'More complex opportunity for a newer exporter',
          component: 'experience',
        });
    } else if (isExperienced(p.exportExperience)) {
      pts = 12 + (3 * a.growthScore) / 100;
      if (ease < 45)
        reasons.push({
          text: 'Your export experience suits a more complex market',
          component: 'experience',
        });
    } else {
      pts = (15 * (0.5 * ease + 30)) / 100;
    }
    add('experience', pts, true);
  } else add('experience', 7.5, false);

  // Category / product (15): category interest, supply-hub location, business type.
  const categoryKnown =
    p.productCategories.length > 0 || p.interestCategories.length > 0;
  {
    let pts = categoryKnown ? 3 : 6;
    if (
      p.productCategories.includes(a.categoryCode) ||
      p.interestCategories.includes(a.categoryCode)
    ) {
      pts += 9;
      reasons.push({
        text: `Matches your ${categoryLabel} category interest`,
        component: 'category',
      });
    }
    if (
      p.stateCode &&
      a.ecosystemStateCodes.slice(0, 3).includes(p.stateCode)
    ) {
      pts += 3;
      reasons.push({
        text: `${p.stateName} is a major Indian supply hub for this product`,
        component: 'category',
      });
    }
    if (p.businessType === 'TRADER' && a.capitalIntensity === 'LOW') {
      pts += 2;
      reasons.push({
        text: 'Lower-capital product suits a trading business',
        component: 'category',
      });
    }
    if (
      p.businessType === 'MANUFACTURER' &&
      p.productCategories.includes(a.categoryCode)
    )
      pts += 1;
    add('category', pts, categoryKnown);
  }

  // Target country (10).
  if (a.countryCode) {
    const rel = p.targets.get(a.countryCode);
    if (rel === 'CURRENT')
      reasons.push({
        text: 'You already export to this market',
        component: 'targetCountry',
      });
    else if (rel === 'INTERESTED')
      reasons.push({
        text: 'One of your target markets',
        component: 'targetCountry',
      });
    add(
      'targetCountry',
      p.targets.size === 0
        ? 5
        : rel === 'CURRENT'
          ? 10
          : rel === 'INTERESTED'
            ? 9
            : 2,
      p.targets.size > 0,
    );
  } else {
    const overlap = a.topDestinations.filter((c) => p.targets.has(c));
    if (overlap.length)
      reasons.push({
        text: `${overlap.length} of your target markets are among India's top destinations for this product`,
        component: 'targetCountry',
      });
    add(
      'targetCountry',
      p.targets.size === 0 ? 5 : overlap.length ? 9 : 3,
      p.targets.size > 0,
    );
  }

  // Risk (15): combined favorable risk (country risk, supply resilience, entry ease) vs tolerance.
  const riskFav =
    avg([a.countryRiskScore, a.supplyResilience, a.marketEntryEase]) ?? 50;
  const tolerance = p.riskTolerance ?? 'BALANCED';
  const riskPts =
    tolerance === 'CONSERVATIVE'
      ? (15 * riskFav) / 100
      : tolerance === 'AGGRESSIVE'
        ? (15 * (0.4 * riskFav + 0.6 * a.growthScore)) / 100
        : (15 * (0.5 * riskFav + 25)) / 100;
  add('risk', riskPts, p.riskTolerance !== null);
  if (tolerance === 'CONSERVATIVE' && riskFav < 50)
    cautions.push({
      text: 'Risk level is higher than your conservative preference',
      component: 'risk',
    });
  else if (tolerance === 'CONSERVATIVE' && riskFav >= 70)
    reasons.push({
      text: 'Lower-risk profile matches your conservative preference',
      component: 'risk',
    });
  else if (tolerance === 'AGGRESSIVE' && a.growthScore >= 65)
    reasons.push({
      text: 'Strong growth suits your aggressive risk appetite',
      component: 'risk',
    });
  else if (tolerance === 'BALANCED' && p.riskTolerance)
    reasons.push({
      text: 'Risk aligns with your balanced profile',
      component: 'risk',
    });

  // Logistics (10).
  {
    let pts = (10 * a.logisticsEase) / 100;
    if (p.preferredLogistics.includes('AIR') && a.airSuitable) pts += 1;
    if (
      (p.shipmentPreference === 'SAMPLES_ONLY' ||
        p.shipmentPreference === 'COURIER_PARCEL') &&
      a.routeComplexity === 'HIGH'
    )
      pts -= 2;
    add('logistics', pts, true);
    if (a.logisticsEase >= 75)
      reasons.push({
        text: 'Logistics complexity is low',
        component: 'logistics',
      });
    if (a.logisticsEase < 45)
      cautions.push({
        text: 'Logistics route is complex (indicative, not a freight quote)',
        component: 'logistics',
      });
  }

  // Margin (10): indicative margin potential vs desired margin (bands, not a margin calculation).
  if (p.desiredMarginMin !== null) {
    const needed =
      p.desiredMarginMin >= 25 ? 67 : p.desiredMarginMin >= 15 ? 40 : 0;
    const ok = a.marginPotential >= needed;
    add('margin', ok ? 10 : 4, true);
    if (!ok)
      cautions.push({
        text: `Indicative margin potential may be below your ${p.desiredMarginMin}% target`,
        component: 'margin',
      });
  } else add('margin', 5, false);

  // Readiness (5): Sprint 3 readiness score + relevant registration gaps (cautions, not legal claims).
  if (p.readinessScore !== null)
    add('readiness', (5 * p.readinessScore) / 100, true);
  else add('readiness', 2.5, false);
  if (p.registrations.get('IEC') !== 'AVAILABLE') {
    cautions.push({
      text: 'Your IEC details are incomplete in Export Setup',
      component: 'readiness',
    });
  }
  if (
    FOOD_RELATED_CATEGORY_CODES.includes(a.categoryCode) &&
    p.registrations.get('FSSAI') !== 'AVAILABLE' &&
    p.registrations.get('APEDA') !== 'AVAILABLE'
  ) {
    const readiness = components.find((c) => c.key === 'readiness')!;
    readiness.points = round1(Math.max(0, readiness.points - 2));
    cautions.push({
      text: 'Complete relevant food/export registration (e.g. FSSAI / APEDA — verify applicability) before pursuing this opportunity',
      component: 'readiness',
    });
  }

  return {
    score: Math.round(components.reduce((s, c) => s + c.points, 0)),
    components,
    reasons,
    cautions,
  };
}

export function recommendationScore(base: number, fit: number): number {
  return Math.round(
    RECOMMENDATION_BASE_WEIGHT * base + RECOMMENDATION_FIT_WEIGHT * fit,
  );
}

export function profileCompleteness(p: FitProfile): RecommendationProfile {
  const checks: [boolean, string][] = [
    [p.investmentRange !== null, 'investment range'],
    [p.exportExperience !== null, 'export experience'],
    [p.riskTolerance !== null, 'risk tolerance'],
    [
      p.productCategories.length > 0 || p.interestCategories.length > 0,
      'product categories',
    ],
    [p.targets.size > 0, 'target countries'],
    [p.desiredMarginMin !== null, 'desired margin'],
    [p.stateCode !== null, 'business state'],
    [
      p.preferredLogistics.length > 0 || p.shipmentPreference !== null,
      'shipment/logistics preference',
    ],
  ];
  const missing = checks.filter(([ok]) => !ok).map(([, name]) => name);
  return {
    completenessPercent: Math.round(
      ((checks.length - missing.length) / checks.length) * 100,
    ),
    missingInputs: missing,
    timelineAvailable: false,
  };
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
