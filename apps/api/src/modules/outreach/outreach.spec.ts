import { createHmac } from 'crypto';
import {
  exclusionReason,
  pickEmailContact,
  rate,
  render,
  safeUrl,
  textToHtml,
  unsupportedClaims,
  validateTemplate,
  withFooter,
} from './outreach-rules';
import { DevelopmentOutreachProvider } from './providers/development.provider';
import { ResendOutreachProvider } from './providers/resend.provider';

const base = {
  address: 'a@b.example',
  contactReason: null,
  isDemo: false,
  production: true,
  suppression: null,
  duplicate: false,
  inCooldown: false,
  overCampaignLimit: false,
};

describe('template validation & rendering', () => {
  it('rejects unknown variables, empty parts and stray braces', () => {
    expect(
      validateTemplate('Hi {{buyerCompany}}', 'Body {{productName}}').valid,
    ).toBe(true);
    const v = validateTemplate('Hi {{buyerName}}', 'x {{ price }}');
    expect(v.valid).toBe(false);
    expect(v.unknownVariables).toEqual(['buyerName', 'price']);
    expect(validateTemplate('', 'x').errors).toContain('Subject is empty.');
    expect(validateTemplate('a', 'b {{productName').valid).toBe(false);
  });

  it('substitutes only allow-listed variables and never evaluates expressions', () => {
    const r = render(
      '{{buyerCompany}}',
      'Dear {{contactName}}, {{productName}} {{constructor}}',
      {
        buyerCompany: 'Acme',
        productName: 'Turmeric',
      },
    );
    expect(r.subject).toBe('Acme');
    expect(r.body).toBe('Dear Sir/Madam, Turmeric {{constructor}}');
    expect(r.unresolved).toEqual(['constructor']);
    expect(render('x', '{{hsCode}}', {}).unresolved).toEqual(['hsCode']);
  });

  it('escapes HTML and appends footer once', () => {
    expect(textToHtml('<script>x</script>\n\nok')).not.toContain('<script>');
    const f = withFooter('Body', 'Sig', 'https://app/unsubscribe/t');
    expect(f).toContain('Sig');
    expect(f).toContain('https://app/unsubscribe/t');
    expect(
      withFooter(f, 'Sig', 'https://app/unsubscribe/t').match(/unsubscribe/g)
        ?.length,
    ).toBe(1);
  });

  it('validates URLs', () => {
    expect(safeUrl('example.com')).toBe('https://example.com');
    expect(safeUrl('http://localhost:3000')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://user:pw@x.com')).toBeNull();
  });
});

describe('eligibility', () => {
  it('applies rules in a fixed order', () => {
    expect(exclusionReason(base)).toBeNull();
    expect(
      exclusionReason({ ...base, address: null, contactReason: 'NO_CONTACT' }),
    ).toBe('NO_CONTACT');
    expect(exclusionReason({ ...base, suppression: 'HARD_BOUNCE' })).toBe(
      'SUPPRESSED_BOUNCE',
    );
    expect(exclusionReason({ ...base, suppression: 'UNSUBSCRIBED' })).toBe(
      'SUPPRESSED_UNSUBSCRIBED',
    );
    expect(exclusionReason({ ...base, isDemo: true })).toBe('DEMO_RECIPIENT');
    // Demo buyers are allowed only for development delivery.
    expect(
      exclusionReason({ ...base, isDemo: true, production: false }),
    ).toBeNull();
    expect(exclusionReason({ ...base, duplicate: true })).toBe('DUPLICATE');
    expect(exclusionReason({ ...base, inCooldown: true })).toBe('COOLDOWN');
    expect(exclusionReason({ ...base, overCampaignLimit: true })).toBe(
      'CAMPAIGN_LIMIT',
    );
  });

  it('picks a usable email contact and never an invalid one', () => {
    const c = (o: object) => ({
      id: 'x',
      name: null,
      contactType: 'EMAIL',
      value: 'p@acme.example',
      verificationStatus: 'FORMAT_VALID',
      confidence: 50,
      isPrimary: false,
      ...o,
    });
    expect(
      pickEmailContact([c({ contactType: 'PHONE', value: '+1' })]).reason,
    ).toBe('NO_CONTACT');
    expect(
      pickEmailContact([c({ verificationStatus: 'INVALID' })]).reason,
    ).toBe('INVALID_CONTACT');
    expect(pickEmailContact([c({ value: 'not-an-email' })]).reason).toBe(
      'INVALID_CONTACT',
    );
    expect(
      pickEmailContact([
        c({ id: 'a', confidence: 30 }),
        c({ id: 'b', confidence: 80 }),
      ]).contact?.id,
    ).toBe('b');
  });
});

describe('analytics math', () => {
  it('returns null for zero or unsupported denominators', () => {
    expect(rate(1, 4)).toBe(25);
    expect(rate(0, 0)).toBeNull();
    expect(rate(null, 5)).toBeNull();
    expect(rate(2, 3)).toBe(66.7);
  });
});

describe('honesty guard', () => {
  it('flags prices, certifications, capacity and relationship claims not in facts', () => {
    const facts = [
      'Exporter company: Acme',
      'Certifications declared by the exporter: ISO 22000',
    ];
    expect(unsupportedClaims('We hold ISO 22000.', facts)).toEqual([]);
    expect(unsupportedClaims('Price USD 5 per kg', facts)).toHaveLength(1);
    expect(unsupportedClaims('We are HACCP certified', facts)).toHaveLength(1);
    expect(unsupportedClaims('We ship 40 MT per month', facts)).toHaveLength(1);
    expect(
      unsupportedClaims('Following our call last week', facts),
    ).toHaveLength(1);
  });
});

describe('providers', () => {
  it('development provider is simulated and reports no delivery signals', async () => {
    const p = new DevelopmentOutreachProvider();
    expect(p.capabilities).toMatchObject({
      realDelivery: false,
      delivered: false,
      opened: false,
      replies: false,
    });
    const r = await p.send({
      channel: 'EMAIL',
      idempotencyKey: 'k',
      to: 'a@b.example',
      fromName: 'A',
      fromEmail: 'a@a.example',
      replyTo: null,
      subject: 's',
      text: 't',
      html: 'h',
      unsubscribeUrl: null,
      testSend: false,
    });
    expect(r).toEqual({ providerMessageId: null, simulated: true });
    expect((await p.validateConfiguration()).status).toBe('DEVELOPMENT_ONLY');
    expect(p.verifyWebhook()).toBe(false);
  });

  it('resend webhook verification rejects bad signatures and parses bounces', () => {
    const secret = `whsec_${Buffer.from('test-secret-key-1234').toString('base64')}`;
    const p = new ResendOutreachProvider('re_test', secret);
    const body = JSON.stringify({
      type: 'email.bounced',
      created_at: '2026-10-07T00:00:00Z',
      data: { email_id: 'em_1', bounce: { type: 'Permanent' } },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', Buffer.from('test-secret-key-1234'))
      .update(`msg_1.${ts}.${body}`)
      .digest('base64');
    const h = {
      'svix-id': 'msg_1',
      'svix-timestamp': ts,
      'svix-signature': `v1,${sig}`,
    };
    expect(p.verifyWebhook(Buffer.from(body), h)).toBe(true);
    expect(p.verifyWebhook(Buffer.from(body + ' '), h)).toBe(false);
    expect(
      p.verifyWebhook(Buffer.from(body), { ...h, 'svix-timestamp': '1000' }),
    ).toBe(false);
    expect(
      new ResendOutreachProvider('k', undefined).verifyWebhook(
        Buffer.from(body),
        h,
      ),
    ).toBe(false);
    const [e] = p.parseWebhook(JSON.parse(body));
    expect(e).toMatchObject({
      type: 'BOUNCED',
      providerMessageId: 'em_1',
      permanentBounce: true,
    });
    expect(
      p.parseWebhook({
        type: 'email.bounced',
        data: { email_id: 'x', bounce: { type: 'Transient' } },
      })[0].permanentBounce,
    ).toBe(false);
    expect(p.parseWebhook({ type: 'unknown' })).toEqual([]);
  });
});
