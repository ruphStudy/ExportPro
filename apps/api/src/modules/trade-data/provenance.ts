import type { DataProvenance, FreshnessStatus } from '@exportpro/types';
import { QUALITY_SCORE } from './reliability';

/** Provenance for an explicitly labelled demo/sample section. */
export function demoProvenance(
  code: string,
  name: string,
  sourceDate: string,
  freshness: FreshnessStatus,
  methodology: string,
  datasetVersion: string,
): DataProvenance {
  return {
    sourceId: null,
    sourceCode: code,
    sourceName: name,
    sourceType: 'DEMO',
    authority: 'ExportPro (synthetic)',
    official: false,
    sourceQuality: 'DEMO',
    sourceDate,
    lastIngestedAt: null,
    freshness,
    confidence: QUALITY_SCORE.DEMO,
    provenanceType: 'DEMO',
    datasetVersion,
    derived: false,
    methodology,
  };
}

/** Provenance for a system calculation over other sections (never "official", even if inputs are). */
export function derivedProvenance(
  inputs: DataProvenance[],
  methodology: string,
  calcVersion: string,
): DataProvenance {
  const anyReal = inputs.some((p) => p.provenanceType !== 'DEMO');
  const allDemo = inputs.every((p) => p.provenanceType === 'DEMO');
  return {
    sourceId: null,
    sourceCode: 'EXPORTPRO_DERIVED',
    sourceName: allDemo
      ? 'ExportPro calculation over sample data'
      : anyReal
        ? 'ExportPro calculation over mixed sources'
        : 'ExportPro calculation',
    sourceType: 'INTERNAL',
    authority: 'ExportPro (deterministic calculation)',
    official: false,
    sourceQuality: 'D',
    sourceDate:
      inputs
        .map((p) => p.sourceDate)
        .filter(Boolean)
        .sort()
        .pop() ?? null,
    lastIngestedAt: null,
    freshness:
      inputs.find((p) => p.provenanceType !== 'DEMO')?.freshness ??
      inputs[0]?.freshness ??
      'UNKNOWN',
    confidence: inputs.length
      ? Math.round(inputs.reduce((s, p) => s + p.confidence, 0) / inputs.length)
      : 0,
    provenanceType: 'SYSTEM_DERIVED',
    datasetVersion: `${calcVersion}[${inputs.map((p) => p.datasetVersion ?? p.sourceCode).join('+')}]`,
    derived: true,
    methodology,
  };
}
