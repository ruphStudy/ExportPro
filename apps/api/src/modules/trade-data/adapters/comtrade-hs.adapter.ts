import {
  FetchedUnit,
  HsReferenceRow,
  ParsedUnit,
  SchemaMismatchError,
  TradeDataSourceAdapter,
} from './adapter';
import { PoliteHttpClient } from './http';

/** HS 2022 (Comtrade "H6") classification reference: chapters, headings, subheadings. */
export class ComtradeHsReferenceAdapter implements TradeDataSourceAdapter {
  readonly sourceCode = 'UN_COMTRADE_HS';
  readonly output = 'HS_REFERENCE' as const;
  readonly mode = 'API' as const;
  readonly datasets = ['HS_2022'];
  private readonly http = new PoliteHttpClient(1000, 60_000);

  constructor(private readonly url: string) {}

  validateConfiguration(): string[] {
    return /^https:\/\//.test(this.url)
      ? []
      : ['HS reference URL must be https.'];
  }

  async *fetchData() {
    yield {
      datasetKey: 'HS_2022',
      sourceRecordKey: 'HS.json',
      sourcePeriod: 'HS2022',
      payload: await this.http.getJson(this.url),
    } as FetchedUnit;
  }

  parse(unit: FetchedUnit): ParsedUnit {
    const results = (unit.payload as { results?: unknown })?.results;
    if (!Array.isArray(results))
      throw new SchemaMismatchError(
        ['results[]'],
        Object.keys((unit.payload as object) ?? {}),
        'HS reference has no results array',
      );
    const reference: HsReferenceRow[] = [];
    let skipped = 0;
    for (const r of results as Record<string, unknown>[]) {
      if (!('id' in r) || !('text' in r) || !('parent' in r))
        throw new SchemaMismatchError(
          ['id', 'text', 'parent'],
          Object.keys(r),
          'HS row shape changed',
        );
      const code = String(r.id);
      if (!/^\d{2}(\d{2})?(\d{2})?$/.test(code)) {
        skipped++; // "TOTAL" and other non-code nodes
        continue;
      }
      const text = String(r.text)
        .replace(new RegExp(`^${code}\\s*-\\s*`), '')
        .trim();
      reference.push({
        code,
        level: code.length,
        parentCode: /^\d+$/.test(String(r.parent)) ? String(r.parent) : null,
        description: text,
      });
    }
    return { reference, skipped };
  }

  sourceVersion(): string {
    return 'HS2022 (H6)';
  }
}
