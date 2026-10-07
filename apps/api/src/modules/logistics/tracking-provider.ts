import type { TrackingEventType } from '@exportpro/types';

export const SHIPMENT_TRACKING_PROVIDER = Symbol('SHIPMENT_TRACKING_PROVIDER');

/** Event as delivered by a carrier/aggregator/airline provider (normalized by the provider adapter). */
export interface ProviderTrackingEvent {
  eventType: TrackingEventType;
  eventTime: Date;
  estimated: boolean;
  location: string | null;
  containerNumber: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
  flightNumber: string | null;
  newEta: Date | null;
  newEtd: Date | null;
  description: string;
  sourceReference: string | null;
}

export interface ShipmentTrackingQuery {
  mode: string;
  carrier: string | null;
  bookingReference: string | null;
  blNumber: string | null;
  awbNumber: string | null;
  containerNumbers: string[];
}

/**
 * Pluggable tracking source (shipping line API, aggregator, airline). Business
 * rules never depend on a specific carrier. No website scraping.
 */
export interface ShipmentTrackingProvider {
  readonly name: string;
  readonly configured: boolean;
  fetch(q: ShipmentTrackingQuery): Promise<ProviderTrackingEvent[]>;
}

/** Default: no live tracking integration is configured; manual tracking is used. */
export class UnconfiguredTrackingProvider implements ShipmentTrackingProvider {
  readonly name = 'none';
  readonly configured = false;
  fetch(): Promise<ProviderTrackingEvent[]> {
    return Promise.reject(
      new Error('No carrier tracking provider is configured.'),
    );
  }
}
