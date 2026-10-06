import { TradeDataOverlayService } from '../../trade-data/overlay/trade-data-overlay.service';
import { QUALITY_SCORE } from '../../trade-data/reliability';
import {
  CountryDatasetSource,
  CountryProfile,
  CountryTradeDataProvider,
  ProductCountryMarket,
} from './country-trade-data.provider';
import { SampleCountryDataProvider } from './sample-country-data.provider';

/**
 * Mixed-source market provider: sample product × country markets with
 * real destination-reported import facts layered in where available.
 * Only pairs present in the sample are offered (tariff/barrier/guidance
 * coverage comes from there); real data never invents new pairs.
 */
export class RealDataCountryProvider implements CountryTradeDataProvider {
  constructor(
    private readonly sample: SampleCountryDataProvider,
    private readonly overlay: TradeDataOverlayService,
  ) {}

  get source(): CountryDatasetSource {
    // Version changes whenever real market series change, so score snapshots track the underlying data.
    return {
      ...this.sample.source,
      datasetVersion: `${this.sample.source.datasetVersion}+${this.overlay.version()}`,
    };
  }

  countryProfile(countryCode: string): CountryProfile | null {
    return this.sample.countryProfile(countryCode);
  }

  supportedCountries(): string[] {
    return this.sample.supportedCountries();
  }

  marketsForProduct(productCode: string): ProductCountryMarket[] {
    return this.sample.marketsForProduct(productCode).map((m) => this.apply(m));
  }

  marketsForCountry(countryCode: string): ProductCountryMarket[] {
    return this.sample.marketsForCountry(countryCode).map((m) => this.apply(m));
  }

  market(
    productCode: string,
    countryCode: string,
  ): ProductCountryMarket | null {
    const m = this.sample.market(productCode, countryCode);
    return m ? this.apply(m) : null;
  }

  private apply(m: ProductCountryMarket): ProductCountryMarket {
    const real = this.overlay.marketTrade(m.productCode, m.countryCode);
    if (!real || real.indiaSharePercent === null) return m;
    const unit =
      real.quantityUnit === 'KG'
        ? 'KG'
        : real.quantityUnit === 'NUMBER'
          ? 'NOS'
          : real.quantityUnit;
    return {
      ...m,
      currency: 'USD',
      quantityUnit: unit,
      yearly: real.years.map((y) => ({
        period: String(y.year),
        value: Math.round(y.valueUsd),
        quantity: y.quantity === null ? null : Math.round(y.quantity),
      })),
      monthly: [],
      indiaSharePercent: real.indiaSharePercent,
      indiaSharePreviousPercent: real.indiaSharePreviousPercent,
      indiaRank: real.indiaRank,
      competitors: real.competitors,
      // Real unit value only when quantities are comparable (kg); otherwise pricing is unavailable rather than mixed with sample prices.
      unitValue: real.unitValue,
      realTrade: {
        provenance: real.provenance,
        pricingReal: real.unitValue !== null,
      },
      sourceQuality: Math.round(
        0.6 * QUALITY_SCORE[real.provenance.sourceQuality] +
          0.4 * this.sample.source.quality,
      ),
    };
  }
}
