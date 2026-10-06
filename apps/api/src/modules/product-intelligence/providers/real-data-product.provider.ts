import { TradeDataOverlayService } from '../../trade-data/overlay/trade-data-overlay.service';
import {
  ProductTradeDataProvider,
  ProductTradeDataset,
  TradeDatasetMatch,
  TradeDatasetQuery,
} from './product-trade-data.provider';
import { SampleTradeDataProvider } from './sample-trade-data.provider';

/** Bumped when the compute output shape changes so stored snapshots regenerate lazily. */
const COMPUTE_VERSION = 'pi-v2';

/**
 * Mixed-source provider: starts from the sample dataset for a code, then
 * replaces export trend + destinations with real normalized trade facts
 * when at least two real years exist. States, districts, ports, monthly
 * seasonality and product signals remain sample (no real source yet) and
 * stay labelled as such. Without real coverage the sample is returned as-is.
 */
export class RealDataProductProvider implements ProductTradeDataProvider {
  readonly name = 'real+sample';

  constructor(
    private readonly sample: SampleTradeDataProvider,
    private readonly overlay: TradeDataOverlayService,
  ) {}

  find(query: TradeDatasetQuery): TradeDatasetMatch | null {
    const match = this.sample.find(query);
    if (!match) return null;
    return { ...match, dataset: this.overlayDataset(match.dataset) };
  }

  private overlayDataset(d: ProductTradeDataset): ProductTradeDataset {
    const real = this.overlay.productTrade(d.code);
    if (!real || real.years.length < 2)
      return { ...d, datasetVersion: `${d.datasetVersion}#${COMPUTE_VERSION}` };
    // Display unit: keep tonnes for bulk products the sample expressed in MT; never convert across unit families.
    const toMt = real.quantityUnit === 'KG' && d.quantityUnit === 'MT';
    const unit =
      real.quantityUnit === 'KG'
        ? toMt
          ? 'MT'
          : 'KG'
        : real.quantityUnit === 'NUMBER'
          ? 'NOS'
          : real.quantityUnit;
    return {
      ...d,
      datasetVersion: `${d.datasetVersion}+${real.version}#${COMPUTE_VERSION}`,
      currency: 'USD',
      quantityUnit: unit,
      yearly: real.years.map((y) => ({
        period: String(y.year),
        value: Math.round(y.valueUsd),
        quantity:
          y.quantity === null
            ? null
            : Math.round(toMt ? y.quantity / 1000 : y.quantity),
      })),
      // The real source is annual; monthly points are not synthesized.
      monthly: [],
      seasonalityMonthly: d.monthly.length ? d.monthly : undefined,
      destinations: real.destinations,
      realTrade: { provenance: real.provenance },
    };
  }
}
