import { ServiceUnavailableException } from '@nestjs/common';
import { detectProductInput, isValidCodeFormat } from '@exportpro/types';
import { ProductAnalysisService } from './product-analysis.service';
import {
  classificationOutputSchema,
  ClassificationProviderError,
  ClassificationRequest,
  ProductClassificationProvider,
} from './providers/classification-provider';
import { DevelopmentClassificationProvider } from './providers/development-classification.provider';
import { createClassificationProvider } from './providers/provider.factory';

const request = (
  input: string,
  answers: string[] = [],
): ClassificationRequest => ({
  input,
  inputType: 'PRODUCT_NAME',
  categoryHint: null,
  details: {},
  clarifications: answers.map((answer) => ({ question: 'q', answer })),
  codeHint: null,
  allowedCategoryCodes: ['SPICES', 'OTHER'],
});

function serviceWith(provider: ProductClassificationProvider) {
  const tariff = { lookupMany: jest.fn().mockResolvedValue(new Map()) };
  return new ProductAnalysisService(
    {} as never,
    {} as never,
    tariff as never,
    {} as never,
    provider,
  );
}

const stub = (
  classify: () => Promise<unknown>,
): ProductClassificationProvider => ({
  identity: {
    name: 'stub',
    model: 'stub-model',
    sourceType: 'AI_DERIVED',
    promptVersion: 't',
  },
  classify,
});

const providerResult = (
  svc: ProductAnalysisService,
  req: ClassificationRequest,
) =>
  (
    svc as unknown as { providerResult(r: ClassificationRequest): Promise<any> }
  ).providerResult(req);

describe('input detection', () => {
  it.each([
    ['Cumin Seeds', 'PRODUCT_NAME', false],
    ['090931', 'HS_CODE', false],
    ['0909', 'HS_CODE', true],
    ['0909.31', 'HS_CODE', false],
    ['61091000', 'ITC_HS_CODE', false],
    [
      'Biodegradable round dinner plates made from areca palm leaves',
      'DESCRIPTION',
      false,
    ],
  ])('%s → %s', (input, type, partial) => {
    const d = detectProductInput(input);
    expect(d.inputType).toBe(type);
    expect(d.isPartialCode).toBe(partial);
  });

  it('flags invalid code lengths', () => {
    expect(detectProductInput('09093').formatError).not.toBeNull();
    expect(isValidCodeFormat('0909', 'ITC_HS_INDIA')).toBe(false);
  });
});

describe('DevelopmentClassificationProvider', () => {
  const dev = new DevelopmentClassificationProvider();

  it('returns schema-valid output for every sample', async () => {
    for (const input of [
      'Cumin Seeds',
      'Plastic container',
      'Cotton T-shirt',
      'LED power supply/driver',
      'Herbal cosmetic cream',
      'Unknown widget',
    ]) {
      expect(
        classificationOutputSchema.safeParse(await dev.classify(request(input)))
          .success,
      ).toBe(true);
    }
  });

  it('distinguishes clear from ambiguous products', async () => {
    expect(
      (await dev.classify(request('Cumin Seeds'))).ambiguity.isAmbiguous,
    ).toBe(false);
    expect(
      (await dev.classify(request('Plastic container'))).ambiguity.isAmbiguous,
    ).toBe(true);
    expect(
      (await dev.classify(request('Herbal cosmetic cream'))).ambiguity
        .isAmbiguous,
    ).toBe(true);
  });

  it('improves after clarification', async () => {
    const out = await dev.classify(
      request('Plastic container', ['Household / kitchen storage']),
    );
    expect(out.ambiguity.isAmbiguous).toBe(false);
    expect(out.primaryCandidate?.code).toBe('392410');
  });

  it('does not read "neither crushed nor ground" as ground', async () => {
    const out = await dev.classify(
      request('Cumin seeds, neither crushed nor ground'),
    );
    expect(out.primaryCandidate?.code).toBe('090931');
  });

  it('returns low confidence and no code for unknown products', async () => {
    const out = await dev.classify(request('Quantum flux widget'));
    expect(out.primaryCandidate).toBeNull();
    expect(out.identification.confidence).toBeLessThan(50);
  });
});

describe('provider failure handling', () => {
  it.each([
    'TIMEOUT',
    'RATE_LIMITED',
    'UNAVAILABLE',
    'NOT_CONFIGURED',
    'INVALID_RESPONSE',
  ] as const)('%s → safe 503', async (kind) => {
    const svc = serviceWith(
      stub(() =>
        Promise.reject(
          new ClassificationProviderError(kind, 'raw secret detail'),
        ),
      ),
    );
    const err = await providerResult(svc, request('x')).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toBe('Product analysis is temporarily unavailable.');
  });

  it('rejects malformed / schema-invalid output', async () => {
    for (const raw of ['not json', { normalizedProductName: 'x' }, null]) {
      const svc = serviceWith(stub(() => Promise.resolve(raw)));
      await expect(providerResult(svc, request('x'))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
  });
});

describe('output guardrails', () => {
  const base = {
    normalizedProductName: 'Widget',
    summary: 's',
    category: 'NOT_A_CATEGORY',
    identification: {
      material: null,
      form: null,
      intendedUse: null,
      composition: null,
      confidence: 90,
    },
    alternatives: [
      {
        code: '090931',
        codeSystem: 'HS',
        description: 'dup',
        confidence: 50,
        reasoning: '',
      },
      {
        code: '0909311',
        codeSystem: 'HS',
        description: 'bad length',
        confidence: 50,
        reasoning: '',
      },
      {
        code: '090932',
        codeSystem: 'ITC_HS_INDIA',
        description: 'wrong system',
        confidence: 50,
        reasoning: '',
      },
    ],
  };

  it('caps confidence when ambiguous, maps unknown categories, drops invalid/duplicate codes', async () => {
    const svc = serviceWith(
      stub(async () => ({
        ...base,
        primaryCandidate: {
          code: '090931',
          codeSystem: 'HS',
          description: 'd',
          confidence: 95,
          reasoning: 'r',
        },
        ambiguity: {
          isAmbiguous: true,
          reason: 'unclear',
          clarifyingQuestions: [],
        },
      })),
    );
    const result = await providerResult(svc, request('x'));
    expect(result.ambiguityStatus).toBe('AMBIGUOUS');
    expect(result.suggestedCategoryCode).toBe('OTHER');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].confidence).toBeLessThanOrEqual(60);
    expect(result.candidates[0].source).toBe('AI_SUGGESTED');
  });

  it('marks no-candidate output as insufficient information', async () => {
    const svc = serviceWith(
      stub(async () => ({
        ...base,
        alternatives: [],
        primaryCandidate: null,
        ambiguity: {
          isAmbiguous: false,
          reason: null,
          clarifyingQuestions: [],
        },
      })),
    );
    expect((await providerResult(svc, request('x'))).ambiguityStatus).toBe(
      'INSUFFICIENT_INFORMATION',
    );
  });
});

describe('provider factory', () => {
  const ai = {
    provider: undefined,
    apiKey: undefined,
    model: 'claude-opus-5-5',
    timeoutMs: 1000,
    enabled: true,
  };

  it('uses the development provider only outside production', () => {
    expect(createClassificationProvider(ai, 'development').identity.name).toBe(
      'development',
    );
    expect(
      createClassificationProvider(
        { ...ai, provider: 'development' },
        'production',
      ).identity.name,
    ).toBe('unconfigured');
    expect(createClassificationProvider(ai, 'production').identity.name).toBe(
      'unconfigured',
    );
  });

  it('uses Anthropic when a key is configured', () => {
    const p = createClassificationProvider(
      { ...ai, apiKey: 'test-key' },
      'production',
    );
    expect(p.identity).toMatchObject({
      name: 'anthropic',
      sourceType: 'AI_DERIVED',
      model: 'claude-opus-5-5',
    });
  });
});
