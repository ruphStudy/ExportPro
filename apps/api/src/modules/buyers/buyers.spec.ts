import {
  analyzeEmail,
  deriveImportFrequency,
  isValidPhone,
  nameSimilarity,
  normalizeBuyerType,
  normalizeCompanyName,
  normalizeCompanySize,
  normalizeWebsite,
  sanitizeText,
} from './buyer-normalization';
import {
  buyerMatch,
  buyerRisk,
  contactConfidence,
  contactStatus,
  type ContactInput,
  type MatchBuyer,
  type MatchContext,
  verificationStatus,
} from './buyer-scoring';
import {
  SAMPLE_DIRECTORY,
  SAMPLE_IMPORT_RECORDS,
} from './providers/sample-buyers.fixtures';

const NOW = new Date('2026-10-07T00:00:00Z');

describe('buyer normalization', () => {
  it('normalizes company names and legal suffixes', () => {
    expect(normalizeCompanyName('ACME GULF FOODS DEMO L.L.C.')).toBe(
      normalizeCompanyName('Acme Gulf Foods Demo LLC'),
    );
    expect(normalizeCompanyName('Example Gewürz Import Demo GmbH')).toBe(
      'example gewurz import demo',
    );
    expect(
      nameSimilarity(
        'Oasis Example Distribution Demo LLC',
        'Oasis Example Distributors Demo',
      ),
    ).toBeGreaterThanOrEqual(0.6);
  });

  it('validates websites without network access', () => {
    expect(normalizeWebsite('www.acme-gulf-foods.example')).toMatchObject({
      valid: true,
      domain: 'acme-gulf-foods.example',
    });
    expect(normalizeWebsite('http://demo home living')?.valid).toBe(false);
    expect(normalizeWebsite('http://127.0.0.1/admin')?.valid).toBe(false);
    expect(normalizeWebsite('https://user:pw@example.com')?.valid).toBe(false);
    expect(normalizeWebsite('ftp://files.example.com')?.valid).toBe(false);
    expect(normalizeWebsite('')).toBeNull();
  });

  it('analyzes emails and phones by syntax only', () => {
    expect(analyzeEmail('procurement@acme.example')).toMatchObject({
      valid: true,
      freeMail: false,
      generic: false,
    });
    expect(analyzeEmail('someone@gmail.com').freeMail).toBe(true);
    expect(analyzeEmail('kontakt@@x.example').valid).toBe(false);
    expect(isValidPhone('+44 20 7946 0101')).toBe(true);
    expect(isValidPhone('0555 12')).toBe(false);
  });

  it('maps buyer types, sizes and frequencies with documented thresholds', () => {
    expect(normalizeBuyerType('Importer & Distributor')).toBe('IMPORTER');
    expect(normalizeBuyerType('Consignee')).toBe('IMPORTER');
    expect(normalizeBuyerType('Cash and carry wholesaler')).toBe('WHOLESALER');
    expect(normalizeBuyerType('Supermarket chain')).toBe('RETAILER');
    expect(normalizeBuyerType('Luminaire manufacturer')).toBe('MANUFACTURER');
    expect(normalizeBuyerType('Sourcing agent')).toBe('AGENT');
    expect(normalizeBuyerType(null)).toBe('UNKNOWN');
    expect(normalizeCompanySize('51-200 employees')).toBe('MEDIUM');
    expect(normalizeCompanySize('1000+ employees')).toBe('ENTERPRISE');
    expect(normalizeCompanySize('big company')).toBe('UNKNOWN');
    expect([24, 12, 4, 1, 0, null].map(deriveImportFrequency)).toEqual([
      'HIGH_FREQUENCY',
      'FREQUENT',
      'REGULAR',
      'OCCASIONAL',
      'UNKNOWN',
      'UNKNOWN',
    ]);
  });

  it('strips control characters from free text', () => {
    expect(sanitizeText('  hi\u0000 there  ', 100)).toBe('hi there');
    expect(sanitizeText('   ', 100)).toBeNull();
  });
});

describe('contact verification & confidence', () => {
  const base: ContactInput = {
    contactType: 'EMAIL',
    value: 'procurement@acme.example',
    role: 'Procurement Manager',
    name: null,
    verificationMethod: null,
    verifiedAt: null,
    lastCheckedAt: new Date('2026-08-01'),
    sourceTier: 'B',
    sourceUpdatedAt: null,
    userProvided: false,
  };

  it('never marks a contact VERIFIED without a verification mechanism', () => {
    expect(contactStatus(base, 'acme.example', NOW).status).toBe(
      'DOMAIN_MATCHED',
    );
    expect(
      contactStatus(
        {
          ...base,
          verificationMethod: 'MAILBOX_CHECK',
          verifiedAt: new Date('2026-08-01'),
        },
        'acme.example',
        NOW,
      ).status,
    ).toBe('VERIFIED');
    expect(
      contactStatus({ ...base, value: 'a@other.example' }, 'acme.example', NOW)
        .status,
    ).toBe('FORMAT_VALID');
    expect(
      contactStatus({ ...base, value: 'bad@@x' }, 'acme.example', NOW).status,
    ).toBe('INVALID');
    expect(
      contactStatus(
        { ...base, lastCheckedAt: new Date('2022-01-01') },
        'acme.example',
        NOW,
      ).status,
    ).toBe('STALE');
  });

  it('scores company-domain, recent, role-relevant contacts higher than free-mail stale ones', () => {
    const good = contactConfidence(
      base,
      'DOMAIN_MATCHED',
      'acme.example',
      false,
      NOW,
    );
    const weak = contactConfidence(
      {
        ...base,
        value: 'x@gmail.com',
        role: null,
        lastCheckedAt: new Date('2023-01-01'),
        sourceTier: 'DEMO',
      },
      'STALE',
      'acme.example',
      false,
      NOW,
    );
    expect(good).toBeGreaterThanOrEqual(75);
    expect(weak).toBeLessThan(25);
    expect(contactConfidence(base, 'INVALID', 'acme.example', false, NOW)).toBe(
      0,
    );
  });
});

describe('verification, risk and match stay separate', () => {
  const ctx: MatchContext = {
    hsCode: '090931',
    itcHsCode: null,
    categoryCode: 'SPICES',
    productName: null,
    countryCode: 'AE',
    targetCountries: [],
  };
  const buyer: MatchBuyer = {
    countryCode: 'AE',
    buyerType: 'IMPORTER',
    businessCategory: 'SPICES',
    companySize: 'MEDIUM',
    activities: [
      {
        activityType: 'TRADE_ACTIVITY',
        hsCode: '090931',
        productName: 'Cumin',
        importFrequency: 'HIGH_FREQUENCY',
        lastActivityDate: new Date('2026-09-01'),
      },
    ],
    bestContactConfidence: 90,
  };

  it('scores exact HS above heading above chapter and explains it', () => {
    const exact = buyerMatch(ctx, buyer, NOW);
    expect(exact.level).toBe('EXACT_HS');
    expect(exact.score).toBeGreaterThanOrEqual(95);
    expect(exact.reasons.map((r) => r.text)).toContain('Deals in HS 090931');
    const heading = buyerMatch(
      ctx,
      { ...buyer, activities: [{ ...buyer.activities[0], hsCode: '0909' }] },
      NOW,
    );
    const chapter = buyerMatch(
      ctx,
      { ...buyer, activities: [{ ...buyer.activities[0], hsCode: '091011' }] },
      NOW,
    );
    expect(heading.level).toBe('HS_HEADING');
    expect(chapter.level).toBe('HS_CHAPTER');
    expect(exact.score).toBeGreaterThan(heading.score);
    expect(heading.score).toBeGreaterThan(chapter.score);
    expect(exact.components.reduce((s, c) => s + c.max, 0)).toBe(100);
  });

  it('keeps a high match even when risk is high', () => {
    const warnings = [
      {
        code: 'CONFLICTING_NAME' as const,
        severity: 'CONCERN' as const,
        message: 'names differ',
      },
      {
        code: 'FREE_MAIL_PRIMARY' as const,
        severity: 'CONCERN' as const,
        message: 'free mail',
      },
    ];
    const ver = verificationStatus(
      [
        {
          tier: 'C',
          sourceType: 'BUSINESS_DIRECTORY',
          active: true,
          demo: false,
          userProvided: false,
          registry: false,
          registryActive: false,
          sourceUpdatedAt: new Date('2026-08-01'),
        },
      ],
      warnings,
      true,
      NOW,
    );
    expect(ver.status).toBe('SUSPICIOUS');
    expect(ver.explanation).toMatch(/not evidence of fraud/);
    const risk = buyerRisk(
      {
        verification: ver.status,
        warnings,
        newestSourceUpdate: new Date('2026-08-01'),
        hasTradeActivity: true,
        traceableSource: true,
      },
      NOW,
    );
    expect(risk.score).toBeGreaterThanOrEqual(45);
    expect(risk.level).not.toBe('LOW');
    expect(buyerMatch(ctx, buyer, NOW).score).toBeGreaterThanOrEqual(95);
  });

  it('does not treat company size as a risk factor', () => {
    const input = {
      verification: 'VERIFIED_SOURCE' as const,
      warnings: [],
      newestSourceUpdate: new Date('2026-08-01'),
      hasTradeActivity: true,
      traceableSource: true,
    };
    expect(buyerRisk(input, NOW).score).toBe(5);
  });

  it('marks multi-source agreement and stale-only sources correctly', () => {
    const src = {
      tier: 'DEMO' as const,
      sourceType: 'DEMO',
      active: true,
      demo: true,
      userProvided: false,
      registry: false,
      registryActive: false,
      sourceUpdatedAt: new Date('2026-08-01'),
    };
    expect(verificationStatus([src, src], [], true, NOW).status).toBe(
      'MULTI_SOURCE_VERIFIED',
    );
    expect(
      verificationStatus(
        [{ ...src, sourceUpdatedAt: new Date('2022-01-01') }],
        [],
        true,
        NOW,
      ).status,
    ).toBe('NEEDS_REVIEW');
    expect(
      verificationStatus([{ ...src, userProvided: true }], [], false, NOW)
        .status,
    ).toBe('UNVERIFIED');
  });

  it('rescales without product context instead of inventing relevance', () => {
    const m = buyerMatch(
      { ...ctx, hsCode: null, categoryCode: null },
      buyer,
      NOW,
    );
    expect(m.productContextMissing).toBe(true);
    expect(m.components.find((c) => c.key === 'product')).toBeUndefined();
  });
});

describe('sample fixtures are obviously fictional', () => {
  const all = [...SAMPLE_DIRECTORY, ...SAMPLE_IMPORT_RECORDS];
  it('uses demo names, reserved domains and fictional phone ranges', () => {
    for (const r of all) {
      expect(r.name).toMatch(/demo|example|sample/i);
      const site = normalizeWebsite(r.website);
      if (site?.valid) expect(site.domain).toMatch(/\.example$/);
      for (const c of r.contacts) {
        if (
          c.contactType === 'EMAIL' &&
          analyzeEmail(c.value).valid &&
          !analyzeEmail(c.value).freeMail
        )
          expect(analyzeEmail(c.value).domain).toMatch(/\.example$/);
        if (c.contactType === 'PHONE' && isValidPhone(c.value))
          expect(c.value.replace(/\s/g, '')).toMatch(
            /^\+4420794600\d{2}|^\+44207946\d{4}|^\+1\d{3}55501\d{2}/,
          );
      }
    }
  });
});
