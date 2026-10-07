export const INQUIRY_EXTRACTION_PROVIDER = Symbol(
  'INQUIRY_EXTRACTION_PROVIDER',
);

export interface ExtractionIdentity {
  name: string;
  model: string | null;
  promptVersion: string;
  /** AI_DERIVED for real AI; DEVELOPMENT_DEMO for the rule-based dev extractor. */
  provenance: 'AI_DERIVED' | 'DEVELOPMENT_DEMO';
}

export interface ExtractionRequest {
  subject: string;
  body: string;
  /** Text of text-based attachments only. */
  attachments: { filename: string; text: string }[];
  /** Explicitly supplied metadata (never web knowledge). */
  metadata: { buyerCountry: string | null; receivedAt: string };
}

/** Returns raw output; InquiriesService validates and grounds it before storing. */
export interface InquiryExtractionProvider {
  readonly identity: ExtractionIdentity;
  extract(request: ExtractionRequest): Promise<unknown>;
}

export type ExtractionFailureKind =
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE';

export class ExtractionProviderError extends Error {
  constructor(
    readonly kind: ExtractionFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractionProviderError';
  }
}

export function sourceText(r: ExtractionRequest) {
  return [
    `Subject: ${r.subject}`,
    r.body,
    ...r.attachments.map((a) => `--- Attachment ${a.filename} ---\n${a.text}`),
  ].join('\n\n');
}
