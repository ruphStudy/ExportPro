import type { GlobalIntelligence } from '../product-intelligence/product-intelligence.service';
import type { TradeDatasetMatch } from '../product-intelligence/providers/product-trade-data.provider';
import type { ScoredMarket } from '../country-intelligence/market-scoring';
import type { CountryProfile } from '../country-intelligence/providers/country-trade-data.provider';
import { FitAttributes } from './personal-fit';

/**
 * Builds personal-fit inputs from existing Sprint 6 (product) and Sprint 7
 * (market) signals — the single mapping used by Best Markets, comparisons
 * and recommendations so fit numbers agree everywhere.
 */
export function fitAttributes(
  match: TradeDatasetMatch,
  intel: GlobalIntelligence | null,
  market: {
    countryCode: string;
    scored: ScoredMarket;
    profile: CountryProfile;
  } | null,
): FitAttributes {
  const signals = match.dataset.signals;
  const supply =
    intel?.risk.signals.find((s) => s.key === 'supply')?.score ?? null;
  const productGrowth =
    intel?.opportunity.components.find((c) => c.key === 'exportGrowth')
      ?.score ?? 50;
  return {
    categoryCode: match.dataset.categoryCode,
    capitalIntensity: signals.capitalIntensity,
    complianceEase: market
      ? Math.round((signals.complianceEase + market.scored.complianceEase) / 2)
      : signals.complianceEase,
    logisticsEase: market
      ? market.scored.components.logistics
      : signals.logisticsEase,
    marginPotential: signals.marginPotential,
    growthScore: market ? market.scored.components.growth : productGrowth,
    supplyResilience: supply,
    ecosystemStateCodes: intel?.ecosystem.states.map((s) => s.stateCode) ?? [],
    topDestinations:
      intel?.markets.destinations.slice(0, 5).map((d) => d.countryCode) ?? [],
    countryCode: market?.countryCode ?? null,
    countryRiskScore: market?.profile.riskScore ?? null,
    marketEntryEase: market?.scored.entryEase ?? null,
    routeComplexity: market?.profile.routeComplexity ?? null,
    airSuitable: market
      ? market.profile.airSuitability.startsWith('Good')
      : null,
  };
}
