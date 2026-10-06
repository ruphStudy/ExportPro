import { z } from 'zod';
import { ProductInputType } from '@exportpro/types';

export const CLASSIFICATION_PROVIDER = Symbol('CLASSIFICATION_PROVIDER');

export interface ClassificationRequest {
  input: string;
  inputType: ProductInputType;
  categoryHint: string | null;
  details: Record<string, string>;
  clarifications: { question: string; answer: string }[];
  /** A user-entered code the product is believed to fall under, if any. */
  codeHint: string | null;
  allowedCategoryCodes: string[];
}

export interface ProviderIdentity {
  name: string;
  model: string | null;
  sourceType: 'AI_DERIVED' | 'DEVELOPMENT_DEMO';
  promptVersion: string;
}

/**
 * Anything that can turn a product description into classification
 * suggestions: an LLM, a specialized tariff service, or a rules + AI
 * hybrid. Returns raw output — ProductAnalysisService validates it with
 * `classificationOutputSchema` and never trusts it unvalidated.
 */
export interface ProductClassificationProvider {
  readonly identity: ProviderIdentity;
  classify(request: ClassificationRequest): Promise<unknown>;
}

export type ProviderFailureKind =
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE';

/** Normalized provider failure — raw provider errors never reach the client. */
export class ClassificationProviderError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'ClassificationProviderError';
  }
}

const candidateSchema = z.object({
  // Lengths are checked per code system in normalization, where invalid candidates are dropped individually.
  code: z.string().regex(/^\d{2,10}$/),
  codeSystem: z.enum(['HS', 'ITC_HS_INDIA']),
  description: z.string().min(1).max(400),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().max(800),
});

export const classificationOutputSchema = z.object({
  normalizedProductName: z.string().min(1).max(200),
  summary: z.string().min(1).max(1200),
  category: z.string().max(60),
  identification: z.object({
    material: z.string().max(200).nullable(),
    form: z.string().max(200).nullable(),
    intendedUse: z.string().max(300).nullable(),
    composition: z.string().max(300).nullable(),
    confidence: z.number().int().min(0).max(100),
  }),
  primaryCandidate: candidateSchema.nullable(),
  alternatives: z.array(candidateSchema).max(6),
  ambiguity: z.object({
    isAmbiguous: z.boolean(),
    reason: z.string().max(600).nullable(),
    clarifyingQuestions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]{1,40}$/),
          question: z.string().min(1).max(300),
          options: z.array(z.string().min(1).max(120)).max(6),
        }),
      )
      .max(5),
  }),
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;
export type ClassificationOutputCandidate = z.infer<typeof candidateSchema>;

/** JSON Schema mirror of `classificationOutputSchema` for providers that support constrained output. */
export const CLASSIFICATION_OUTPUT_JSON_SCHEMA: Record<string, unknown> =
  (() => {
    const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    const candidate = {
      type: 'object',
      additionalProperties: false,
      required: [
        'code',
        'codeSystem',
        'description',
        'confidence',
        'reasoning',
      ],
      properties: {
        code: {
          type: 'string',
          description: 'Digits only: 4/6 for HS, 8 for ITC_HS_INDIA',
        },
        codeSystem: { type: 'string', enum: ['HS', 'ITC_HS_INDIA'] },
        description: { type: 'string' },
        confidence: { type: 'integer', description: '0-100' },
        reasoning: { type: 'string' },
      },
    };
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'normalizedProductName',
        'summary',
        'category',
        'identification',
        'primaryCandidate',
        'alternatives',
        'ambiguity',
      ],
      properties: {
        normalizedProductName: { type: 'string' },
        summary: { type: 'string' },
        category: { type: 'string' },
        identification: {
          type: 'object',
          additionalProperties: false,
          required: [
            'material',
            'form',
            'intendedUse',
            'composition',
            'confidence',
          ],
          properties: {
            material: nullableString,
            form: nullableString,
            intendedUse: nullableString,
            composition: nullableString,
            confidence: { type: 'integer', description: '0-100' },
          },
        },
        primaryCandidate: { anyOf: [candidate, { type: 'null' }] },
        alternatives: { type: 'array', items: candidate },
        ambiguity: {
          type: 'object',
          additionalProperties: false,
          required: ['isAmbiguous', 'reason', 'clarifyingQuestions'],
          properties: {
            isAmbiguous: { type: 'boolean' },
            reason: nullableString,
            clarifyingQuestions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'question', 'options'],
                properties: {
                  id: { type: 'string', description: 'snake_case identifier' },
                  question: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
  })();
