import {
  computePersonalFit,
  FitAttributes,
  FitProfile,
  PERSONAL_FIT_WEIGHTS,
  profileCompleteness,
  recommendationScore,
} from './personal-fit';

const profile = (over: Partial<FitProfile> = {}): FitProfile => ({
  hasProfile: true,
  investmentRange: 'L5_10',
  exportExperience: 'ONE_TO_THREE_YEARS',
  riskTolerance: 'BALANCED',
  businessType: 'MERCHANT_EXPORTER',
  stateCode: null,
  stateName: null,
  productCategories: [],
  interestCategories: [],
  targets: new Map(),
  preferredLogistics: [],
  shipmentPreference: null,
  desiredMarginMin: null,
  registrations: new Map([['IEC', 'AVAILABLE']]),
  readinessScore: 60,
  readinessActions: [],
  ...over,
});

const easy: FitAttributes = {
  categoryCode: 'HANDICRAFTS',
  capitalIntensity: 'LOW',
  complianceEase: 80,
  logisticsEase: 85,
  marginPotential: 66,
  growthScore: 60,
  supplyResilience: 70,
  ecosystemStateCodes: ['KA'],
  topDestinations: ['US'],
  countryCode: 'AE',
  countryRiskScore: 82,
  marketEntryEase: 85,
  routeComplexity: 'LOW',
  airSuitable: true,
};
const hard: FitAttributes = {
  ...easy,
  categoryCode: 'ELECTRONICS',
  capitalIntensity: 'HIGH',
  complianceEase: 35,
  logisticsEase: 40,
  growthScore: 85,
  supplyResilience: 30,
  countryCode: 'NG',
  countryRiskScore: 30,
  marketEntryEase: 35,
  routeComplexity: 'HIGH',
  airSuitable: false,
};
const pts = (r: ReturnType<typeof computePersonalFit>, k: string) =>
  r.components.find((c) => c.key === k)!.points;

describe('personal fit', () => {
  it('weights sum to 100 and score stays within 0–100', () => {
    expect(Object.values(PERSONAL_FIT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(
      100,
    );
    const r = computePersonalFit(profile(), easy);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('beginner: easier opportunities fit much better', () => {
    const p = profile({ exportExperience: 'NONE' });
    expect(pts(computePersonalFit(p, easy), 'experience')).toBeGreaterThan(
      pts(computePersonalFit(p, hard), 'experience') + 5,
    );
  });

  it('budget mismatch: low budget + high capital lowers fit', () => {
    const low = profile({ investmentRange: 'UNDER_1L' });
    const r = computePersonalFit(low, hard);
    expect(pts(r, 'budget')).toBeLessThanOrEqual(5);
    expect(r.cautions.some((c) => c.component === 'budget')).toBe(true);
    expect(pts(computePersonalFit(low, easy), 'budget')).toBe(20);
  });

  it('target market raises fit with a reason', () => {
    const withTarget = computePersonalFit(
      profile({
        targets: new Map([
          ['AE', 'INTERESTED'],
          ['US', 'CURRENT'],
        ]),
      }),
      easy,
    );
    const other = computePersonalFit(
      profile({ targets: new Map([['US', 'CURRENT']]) }),
      easy,
    );
    expect(withTarget.score).toBeGreaterThan(other.score);
    expect(withTarget.reasons.map((r) => r.text)).toContain(
      'One of your target markets',
    );
  });

  it('risk tolerance: conservative penalizes risky markets more than aggressive', () => {
    const c = pts(
      computePersonalFit(profile({ riskTolerance: 'CONSERVATIVE' }), hard),
      'risk',
    );
    const a = pts(
      computePersonalFit(profile({ riskTolerance: 'AGGRESSIVE' }), hard),
      'risk',
    );
    expect(a).toBeGreaterThan(c);
  });

  it('food product without food registration → caution, no legal claim', () => {
    const r = computePersonalFit(profile(), {
      ...easy,
      categoryCode: 'SPICES',
    });
    const caution = r.cautions.find((c) => c.component === 'readiness')!;
    expect(caution.text).toMatch(/verify applicability/);
    expect(caution.text).not.toMatch(/mandatory|required by law/i);
  });

  it('ranking formula and incomplete profile', () => {
    expect(recommendationScore(80, 50)).toBe(71);
    const empty = profileCompleteness(
      profile({
        investmentRange: null,
        targets: new Map(),
        riskTolerance: null,
      }),
    );
    expect(empty.missingInputs).toEqual(
      expect.arrayContaining([
        'investment range',
        'target countries',
        'risk tolerance',
      ]),
    );
    expect(empty.timelineAvailable).toBe(false);
  });
});
