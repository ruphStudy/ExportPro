import { createHash } from 'crypto';
import type { SourceRecord } from '../normalization/pipeline';
import {
  FetchedUnit,
  ParsedUnit,
  SchemaMismatchError,
  TradeDataSourceAdapter,
} from './adapter';

/** ExportPro manual-import template for India TradeStat / DGCI&S reports (one row per commodity × partner × period). */
export const TRADESTAT_TEMPLATE_COLUMNS = [
  'trade_direction',
  'hs_code',
  'commodity',
  'partner_country',
  'year',
  'month',
  'value',
  'value_unit',
  'quantity',
  'quantity_unit',
  'port',
  'state',
  'district',
] as const;
const REQUIRED = ['hs_code', 'partner_country', 'year', 'value', 'value_unit'];
/** Reported value units → currency + multiplier. Unlisted units are rejected, not guessed. */
const VALUE_UNITS: Record<string, { currency: string; scale: number }> = {
  USD: { currency: 'USD', scale: 1 },
  USD_MILLION: { currency: 'USD', scale: 1_000_000 },
  INR: { currency: 'INR', scale: 1 },
  INR_LAKH: { currency: 'INR', scale: 100_000 },
  INR_CRORE: { currency: 'INR', scale: 10_000_000 },
};
const CHUNK = 1000;

/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF) — avoids
 * a dependency for a single, strict template.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export class TradeStatManualAdapter implements TradeDataSourceAdapter {
  readonly sourceCode = 'INDIA_TRADESTAT';
  readonly output = 'TRADE_FACTS' as const;
  readonly mode = 'MANUAL_IMPORT' as const;
  readonly datasets = ['TRADESTAT_UPLOAD'];

  validateConfiguration(): string[] {
    return [];
  }

  readFile(buffer: Buffer, fileName: string) {
    const isJson = /\.json$/i.test(fileName);
    let objects: Record<string, string>[];
    if (isJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.toString('utf8'));
      } catch {
        throw new SchemaMismatchError(
          ['JSON array of rows'],
          [],
          'file is not valid JSON',
        );
      }
      if (!Array.isArray(parsed))
        throw new SchemaMismatchError(
          ['JSON array of rows'],
          [typeof parsed],
          'JSON root must be an array',
        );
      const keys = new Set<string>();
      for (const o of parsed)
        if (o && typeof o === 'object')
          Object.keys(o).forEach((k) => keys.add(k.trim().toLowerCase()));
      this.checkColumns([...keys]);
      objects = parsed.map((o) =>
        Object.fromEntries(
          Object.entries(o as object).map(([k, v]) => [
            k.trim().toLowerCase(),
            v === null || v === undefined ? '' : String(v),
          ]),
        ),
      );
    } else {
      const rows = parseCsv(buffer.toString('utf8'));
      if (rows.length === 0)
        throw new SchemaMismatchError(
          [...TRADESTAT_TEMPLATE_COLUMNS],
          [],
          'file is empty',
        );
      const header = rows[0].map((h) => h.trim().toLowerCase());
      this.checkColumns(header);
      objects = rows
        .slice(1)
        .map((r) =>
          Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])),
        );
    }
    const units: FetchedUnit[] = [];
    for (let i = 0; i < objects.length; i += CHUNK) {
      units.push({
        datasetKey: 'TRADESTAT_UPLOAD',
        sourceRecordKey: `${fileName}#rows-${i + 2}-${Math.min(i + CHUNK, objects.length) + 1}`,
        sourcePeriod: null,
        payload: { firstRow: i + 2, rows: objects.slice(i, i + CHUNK) },
      });
    }
    return {
      format: isJson ? ('JSON' as const) : ('CSV' as const),
      units,
      rows: objects.length,
    };
  }

  /** Strict: unknown or missing required columns fail the import rather than being reinterpreted. */
  private checkColumns(actual: string[]) {
    const known = new Set<string>(TRADESTAT_TEMPLATE_COLUMNS);
    const unexpected = actual.filter((c) => c && !known.has(c));
    const missing = REQUIRED.filter((c) => !actual.includes(c));
    if (unexpected.length || missing.length) {
      throw new SchemaMismatchError(
        [...TRADESTAT_TEMPLATE_COLUMNS],
        actual,
        [
          missing.length ? `missing required: ${missing.join(', ')}` : '',
          unexpected.length ? `unexpected: ${unexpected.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      );
    }
  }

  parse(unit: FetchedUnit): ParsedUnit {
    const { firstRow, rows } = unit.payload as {
      firstRow: number;
      rows: Record<string, string>[];
    };
    const records: SourceRecord[] = rows.map((r, i) => {
      const valueUnit = VALUE_UNITS[(r.value_unit ?? '').trim().toUpperCase()];
      const direction = (r.trade_direction || 'EXPORT').trim().toUpperCase();
      const rowRef = `row ${firstRow + i}`;
      return {
        rowRef,
        sourceRecordKey: `${unit.sourceRecordKey}:${rowRef}`,
        direction: direction === 'IMPORT' ? 'IMPORT' : 'EXPORT',
        hsCode: r.hs_code,
        allowItc: true,
        reporter: { iso2: 'IN', name: 'India' },
        partner: { name: r.partner_country },
        year: r.year,
        month: r.month || undefined,
        value: r.value,
        valueScale: valueUnit?.scale ?? 1,
        currency: valueUnit?.currency ?? null,
        valueBasis: direction === 'IMPORT' ? 'CIF' : 'FOB',
        quantity: r.quantity,
        unit: r.quantity_unit || null,
        port: r.port || null,
        state: r.state || null,
        district: r.district || null,
        preRejection:
          direction !== 'EXPORT' && direction !== 'IMPORT'
            ? {
                kind: 'INVALID_VALUE' as const,
                field: 'trade_direction',
                value: r.trade_direction,
                message: 'trade_direction must be EXPORT or IMPORT',
              }
            : !valueUnit
              ? {
                  kind: 'INVALID_CURRENCY' as const,
                  field: 'value_unit',
                  value: r.value_unit ?? null,
                  message: `value_unit must be one of ${Object.keys(VALUE_UNITS).join(', ')}`,
                }
              : undefined,
      };
    });
    return { records };
  }

  sourceVersion(units: FetchedUnit[]): string {
    return `upload:${createHash('sha256')
      .update(JSON.stringify(units.map((u) => u.payload)))
      .digest('hex')
      .slice(0, 12)}`;
  }
}
