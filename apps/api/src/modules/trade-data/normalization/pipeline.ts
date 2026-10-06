import { createHash } from 'crypto';
import type {
  CodeSystem,
  MappingStatus,
  PartnerEntityType,
  PeriodType,
  TradeDataIssueKind,
  TradeDataIssueSeverity,
} from '@exportpro/types';
import {
  CountryInput,
  normalizeCountry,
  normalizeCurrency,
  normalizeDistrict,
  normalizeHsCode,
  normalizePeriod,
  normalizePort,
  normalizeQuantity,
  normalizeState,
  parseNonNegative,
  TRANSFORM_VERSION,
} from './normalizers';

/** Source-neutral parsed record produced by an adapter's parse() step. */
export interface SourceRecord {
  rowRef: string;
  sourceRecordKey: string | null;
  direction: 'EXPORT' | 'IMPORT';
  hsCode: unknown;
  allowItc: boolean;
  reporter: CountryInput;
  partner: CountryInput;
  year: unknown;
  month?: unknown;
  quarter?: unknown;
  value: unknown;
  /** Multiplier applied to the reported value (e.g. 1e6 for "US$ million"). */
  valueScale?: number;
  currency: unknown;
  valueBasis?: string | null;
  quantity?: unknown;
  unit?: string | null;
  netWeightKg?: unknown;
  port?: string | null;
  state?: string | null;
  district?: string | null;
  estimated?: boolean | null;
  sourceUpdatedAt?: Date | null;
  /** Adapter-detected problem that must reject the row (e.g. unknown value unit). */
  preRejection?: {
    kind: TradeDataIssueKind;
    field: string;
    value: string | null;
    message: string;
  };
}

export interface PipelineIssue {
  kind: TradeDataIssueKind;
  severity: TradeDataIssueSeverity;
  field: string | null;
  sourceValue: string | null;
  message: string;
  rowRef: string | null;
}

export interface NormalizedFact {
  factKey: string;
  contentHash: string;
  sourceRecordKey: string | null;
  tradeDirection: 'EXPORT' | 'IMPORT';
  codeSystem: CodeSystem;
  hsCode: string;
  hsLevel: number;
  sourceHsCode: string;
  reporterCountryCode: string;
  partnerCountryCode: string | null;
  partnerEntityType: PartnerEntityType;
  sourcePartner: string | null;
  partnerLabel: string;
  periodType: PeriodType;
  year: number;
  month: number | null;
  periodStart: Date;
  periodEnd: Date;
  tradeValue: number | null;
  currency: string;
  valueBasis: string | null;
  normalizedValueUsd: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
  unitMappingStatus: MappingStatus;
  netWeightKg: number | null;
  portCode: string | null;
  stateCode: string | null;
  districtKey: string | null;
  districtLabel: string | null;
  districtMappingStatus: MappingStatus | null;
  isEstimated: boolean | null;
  sourceUpdatedAt: Date | null;
  transformVersion: string;
}

const sha = (parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/**
 * Validate + normalize one parsed record. Rejects only when the record
 * cannot form a trustworthy fact (bad HS, reporter, period, value,
 * currency); uncertain partner/unit/port/state/district mappings keep the
 * record with explicit UNRESOLVED status and the raw form preserved.
 */
export function normalizeRecord(
  rec: SourceRecord,
  sourceId: string,
): { fact: NormalizedFact | null; issues: PipelineIssue[] } {
  const issues: PipelineIssue[] = [];
  const reject = (
    kind: TradeDataIssueKind,
    field: string,
    value: unknown,
    message: string,
  ) => {
    issues.push({
      kind,
      severity: 'REJECTED',
      field,
      sourceValue:
        value === undefined || value === null
          ? null
          : String(value).slice(0, 200),
      message,
      rowRef: rec.rowRef,
    });
    return { fact: null, issues };
  };
  const flag = (
    kind: TradeDataIssueKind,
    field: string,
    value: unknown,
    message: string,
    severity: TradeDataIssueSeverity = 'UNRESOLVED',
  ) =>
    issues.push({
      kind,
      severity,
      field,
      sourceValue:
        value === undefined || value === null
          ? null
          : String(value).slice(0, 200),
      message,
      rowRef: rec.rowRef,
    });

  if (rec.preRejection)
    return reject(
      rec.preRejection.kind,
      rec.preRejection.field,
      rec.preRejection.value,
      rec.preRejection.message,
    );
  const hs = normalizeHsCode(rec.hsCode, rec.allowItc);
  if (!hs.ok)
    return reject(
      'MALFORMED_HS',
      'hsCode',
      rec.hsCode,
      (hs as unknown as { reason: string }).reason,
    );
  const reporter = normalizeCountry(rec.reporter);
  if (!reporter.code)
    return reject(
      'UNKNOWN_COUNTRY',
      'reporter',
      rec.reporter.name ?? rec.reporter.iso2,
      'Reporter country could not be mapped',
    );
  const period = normalizePeriod(rec.year, rec.month, rec.quarter);
  if (!period.ok)
    return reject(
      'INVALID_PERIOD',
      'period',
      `${String(rec.year)}/${String(rec.month ?? '')}`,
      (period as unknown as { reason: string }).reason,
    );
  const value = parseNonNegative(rec.value);
  if (!value.ok)
    return reject(
      'INVALID_VALUE',
      'value',
      rec.value,
      (value as unknown as { reason: string }).reason,
    );
  const currency = normalizeCurrency(rec.currency);
  if (!currency.ok)
    return reject(
      'INVALID_CURRENCY',
      'currency',
      rec.currency,
      (currency as unknown as { reason: string }).reason,
    );
  const qty = parseNonNegative(rec.quantity);
  if (!qty.ok)
    return reject(
      'INVALID_VALUE',
      'quantity',
      rec.quantity,
      (qty as unknown as { reason: string }).reason,
    );
  const weight = parseNonNegative(rec.netWeightKg);

  const partner = normalizeCountry(rec.partner);
  if (partner.status === 'UNRESOLVED')
    flag(
      'UNKNOWN_COUNTRY',
      'partner',
      rec.partner.name ?? rec.partner.iso2,
      `Partner "${partner.label}" kept unresolved (not mapped to a country)`,
    );

  const unit = normalizeQuantity(qty.value, rec.unit ?? null);
  if (qty.value !== null && unit.status === 'UNRESOLVED')
    flag(
      'UNKNOWN_UNIT',
      'unit',
      rec.unit,
      `Unit "${rec.unit ?? '—'}" is unknown; raw quantity kept, not normalized`,
    );

  const port = normalizePort(rec.port);
  if (port && !port.code)
    flag(
      'UNKNOWN_PORT',
      'port',
      rec.port,
      `Port "${rec.port}" not in the Indian port reference`,
    );
  const state = normalizeState(rec.state);
  if (state && !state.code)
    flag(
      'UNKNOWN_STATE',
      'state',
      rec.state,
      `State "${rec.state}" not recognized`,
    );
  const district = normalizeDistrict(rec.district, state?.code ?? null);
  if (district && !district.key)
    flag(
      'UNRESOLVED_DISTRICT',
      'district',
      rec.district,
      'District kept in source form — state unknown',
    );

  const tradeValue =
    value.value === null
      ? null
      : Math.round(value.value * (rec.valueScale ?? 1) * 100) / 100;
  const partnerIdentity =
    partner.code ?? `${partner.entityType}:${partner.label.toLowerCase()}`;
  const factKey = sha([
    sourceId,
    rec.direction,
    hs.codeSystem,
    hs.code,
    reporter.code,
    partnerIdentity,
    period.periodType,
    period.year,
    period.month ?? 0,
    port?.code ?? rec.port ?? '',
    state?.code ?? rec.state ?? '',
    district?.key ?? district?.label ?? '',
  ]);
  const fact: NormalizedFact = {
    factKey,
    contentHash: sha([
      tradeValue,
      currency.code,
      qty.value,
      rec.unit ?? null,
      weight.ok ? weight.value : null,
      rec.estimated ?? null,
      rec.valueBasis ?? null,
    ]),
    sourceRecordKey: rec.sourceRecordKey,
    tradeDirection: rec.direction,
    codeSystem: hs.codeSystem,
    hsCode: hs.code,
    hsLevel: hs.level,
    sourceHsCode: String(rec.hsCode),
    reporterCountryCode: reporter.code,
    partnerCountryCode: partner.code,
    partnerEntityType: partner.entityType,
    sourcePartner: rec.partner.name ?? rec.partner.iso2 ?? null,
    partnerLabel: partner.label,
    periodType: period.periodType,
    year: period.year,
    month: period.month,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    tradeValue,
    currency: currency.code,
    valueBasis: rec.valueBasis ?? null,
    // Only USD-reported values are "normalized USD" — no invented FX conversion.
    normalizedValueUsd: currency.code === 'USD' ? tradeValue : null,
    quantity: qty.value,
    quantityUnit: rec.unit ?? null,
    normalizedQuantity: unit.normalizedQuantity,
    normalizedUnit: unit.normalizedUnit,
    unitMappingStatus:
      qty.value === null ? (rec.unit ? unit.status : 'EXACT') : unit.status,
    netWeightKg: weight.ok ? weight.value : null,
    portCode: port?.code ?? null,
    stateCode: state?.code ?? null,
    districtKey: district?.key ?? null,
    districtLabel: district?.label ?? null,
    districtMappingStatus: district?.status ?? null,
    isEstimated: rec.estimated ?? null,
    sourceUpdatedAt: rec.sourceUpdatedAt ?? null,
    transformVersion: TRANSFORM_VERSION,
  };
  if (currency.code !== 'USD')
    flag(
      'INVALID_CURRENCY',
      'currency',
      currency.code,
      `Value kept in ${currency.code}; no trusted FX rate, so no USD normalization`,
      'WARNING',
    );
  return { fact, issues };
}

export interface DedupResult {
  facts: NormalizedFact[];
  exactDuplicates: number;
  issues: PipelineIssue[];
}

/** Within one run: exact duplicates are skipped; same key with different content keeps the first and is flagged as a conflict. */
export function dedupeFacts(facts: NormalizedFact[]): DedupResult {
  const byKey = new Map<string, NormalizedFact>();
  const issues: PipelineIssue[] = [];
  let exactDuplicates = 0;
  for (const f of facts) {
    const existing = byKey.get(f.factKey);
    if (!existing) byKey.set(f.factKey, f);
    else if (existing.contentHash === f.contentHash) exactDuplicates++;
    else
      issues.push({
        kind: 'CONFLICTING_DUPLICATE',
        severity: 'UNRESOLVED',
        field: 'value',
        sourceValue: `${f.tradeValue ?? 'null'} vs ${existing.tradeValue ?? 'null'}`,
        message: `Conflicting duplicate for ${f.hsCode} / ${f.partnerLabel} / ${f.year}${f.month ? `-${f.month}` : ''}; first record kept`,
        rowRef: f.sourceRecordKey,
      });
  }
  return { facts: [...byKey.values()], exactDuplicates, issues };
}
