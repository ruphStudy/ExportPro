import type { BuyerDataProvider, ProviderBuyerRecord } from './buyer-provider';
import {
  SAMPLE_DIRECTORY,
  SAMPLE_IMPORT_RECORDS,
} from './sample-buyers.fixtures';

/** Clearly labelled DEMO provider: fictional directory listings and contacts. */
export class SampleBuyerDirectoryProvider implements BuyerDataProvider {
  readonly sourceCode = 'EXPORTPRO_SAMPLE_BUYER_DIRECTORY';
  readonly sourceType = 'DEMO' as const;
  readonly demo = true;
  readonly version = 'sample-buyer-directory-v1';
  fetchAll(): Promise<ProviderBuyerRecord[]> {
    return Promise.resolve(SAMPLE_DIRECTORY);
  }
}

/** Clearly labelled DEMO provider: fictional import (consignee) records. */
export class SampleImportRecordsProvider implements BuyerDataProvider {
  readonly sourceCode = 'EXPORTPRO_SAMPLE_IMPORT_RECORDS';
  readonly sourceType = 'DEMO' as const;
  readonly demo = true;
  readonly version = 'sample-import-records-v1';
  fetchAll(): Promise<ProviderBuyerRecord[]> {
    return Promise.resolve(SAMPLE_IMPORT_RECORDS);
  }
}
