import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  ProductAnalysis,
  ProductClassificationCandidate as CandidateRow,
} from '@prisma/client';
import { createHash } from 'crypto';
import {
  AmbiguityStatus,
  ClarificationAnswer,
  ClarificationQuestion,
  ClassificationSource,
  CodeSystem,
  ConfirmClassificationResponse,
  detectProductInput,
  formatTariffCode,
  HSReferenceItem,
  isValidCodeFormat,
  LOW_CONFIDENCE_THRESHOLD,
  normalizeTariffCode,
  PRODUCT_CATEGORIES,
  ProductAnalysisDetails,
  ProductAnalysisResponse,
  ProductClassificationCandidate,
  ProductInputType,
  RecentProductAnalysis,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  assertCategory,
  normalizeProductName,
  ProductsService,
  splitCode,
} from '../products/products.service';
import {
  CLASSIFICATION_PROVIDER,
  ClassificationOutput,
  classificationOutputSchema,
  ClassificationProviderError,
  ClassificationRequest,
  ProductClassificationProvider,
} from './providers/classification-provider';
import { TariffReferenceService } from './reference/tariff-reference.service';
import {
  ClarifyProductAnalysisDto,
  ConfirmClassificationDto,
  CreateProductAnalysisDto,
  SelectClassificationDto,
} from './dto/product-analysis.dto';

const UNAVAILABLE_MESSAGE = 'Product analysis is temporarily unavailable.';
/** Identical input within this window reopens the existing analysis instead of calling the provider again. */
const REUSE_WINDOW_MS = 10 * 60 * 1000;
/** Ambiguous AI results never show more than this confidence on any candidate. */
const AMBIGUOUS_CONFIDENCE_CAP = 60;
const DESCRIPTION_QUESTION_ID = 'product_description';
const REFERENCE_PROVIDER = {
  name: 'tariff-reference',
  promptVersion: 'reference-lookup-v1',
};

/** Chapter → Sprint 3 category, for code-only inputs. Unmapped chapters become OTHER. */
const CHAPTER_CATEGORY: Record<string, string> = {
  '04': 'FOOD_BEVERAGES',
  '08': 'AGRICULTURE',
  '09': 'SPICES',
  '10': 'AGRICULTURE',
  '14': 'HANDICRAFTS',
  '19': 'FOOD_BEVERAGES',
  '21': 'FOOD_BEVERAGES',
  '30': 'PHARMACEUTICALS',
  '33': 'BEAUTY_PERSONAL_CARE',
  '39': 'PLASTICS',
  '42': 'LEATHER',
  '44': 'HANDICRAFTS',
  '46': 'HANDICRAFTS',
  '48': 'PACKAGING',
  '52': 'TEXTILES',
  '61': 'TEXTILES',
  '62': 'TEXTILES',
  '71': 'GEMS_JEWELLERY',
  '73': 'HOME_KITCHEN',
  '82': 'HOME_KITCHEN',
  '84': 'ENGINEERING_GOODS',
  '85': 'ELECTRONICS',
  '87': 'AUTO_COMPONENTS',
  '94': 'FURNITURE',
};

interface NormalizedCandidate {
  code: string;
  codeSystem: CodeSystem;
  description: string;
  confidence: number | null;
  reasoningSummary: string | null;
  source: ClassificationSource;
  inReferenceData: boolean;
  referenceDescription: string | null;
}

interface AnalysisResult {
  normalizedProductName: string;
  productSummary: string;
  suggestedCategoryCode: string;
  identification: {
    material: string | null;
    form: string | null;
    intendedUse: string | null;
    composition: string | null;
  };
  identificationConfidence: number | null;
  ambiguityStatus: AmbiguityStatus;
  ambiguityReason: string | null;
  clarifyingQuestions: ClarificationQuestion[];
  candidates: NormalizedCandidate[];
  sourceType: 'AI_DERIVED' | 'DEVELOPMENT_DEMO' | 'REFERENCE_LOOKUP';
  provider: string;
  model: string | null;
  promptVersion: string;
}

type AnalysisWithRelations = ProductAnalysis & {
  candidates: CandidateRow[];
  product: { id: string; displayName: string } | null;
};

const CATEGORY_CODES = PRODUCT_CATEGORIES.map((c) => c.code);

@Injectable()
export class ProductAnalysisService {
  private readonly logger = new Logger(ProductAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tariff: TariffReferenceService,
    private readonly products: ProductsService,
    @Inject(CLASSIFICATION_PROVIDER)
    private readonly provider: ProductClassificationProvider,
  ) {}

  // --- Create ---------------------------------------------------------

  async analyze(
    organizationId: string,
    userId: string,
    dto: CreateProductAnalysisDto,
    productId: string | null = null,
  ): Promise<ProductAnalysisResponse> {
    const rawInput = dto.input.trim();
    const detected = detectProductInput(rawInput);
    const inputType: ProductInputType = dto.inputType ?? detected.inputType;
    assertCategory(dto.categoryCode);
    const details = sanitizeDetails(dto.details);

    const isCode = inputType === 'HS_CODE' || inputType === 'ITC_HS_CODE';
    const code = isCode ? normalizeTariffCode(rawInput) : null;
    if (code !== null) {
      const system: CodeSystem =
        inputType === 'ITC_HS_CODE' ? 'ITC_HS_INDIA' : 'HS';
      if (!isValidCodeFormat(code, system)) {
        throw new BadRequestException(
          system === 'HS'
            ? 'HS codes must be 2, 4 or 6 digits.'
            : 'ITC-HS codes must be 8 digits.',
        );
      }
    }

    if (dto.productInterestId) {
      const interest = await this.prisma.productInterest.findFirst({
        where: { id: dto.productInterestId, organizationId },
      });
      if (!interest) throw new NotFoundException('Product interest not found.');
    }
    if (dto.opportunityId) {
      const opportunity = await this.prisma.opportunity.findUnique({
        where: { id: dto.opportunityId },
      });
      if (!opportunity) throw new NotFoundException('Opportunity not found.');
    }

    const inputKey = hashKey([
      inputType,
      rawInput.toLowerCase().replace(/\s+/g, ' '),
      dto.categoryCode ?? null,
      details,
      productId,
    ]);
    const recent = await this.prisma.productAnalysis.findFirst({
      where: {
        organizationId,
        inputKey,
        status: 'PENDING_REVIEW',
        revision: 1,
        createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent)
      return {
        ...(await this.getById(organizationId, recent.id)),
        reused: true,
      };

    const result =
      code !== null
        ? await this.referenceResult(code, inputType, dto.categoryCode ?? null)
        : await this.providerResult({
            input: rawInput,
            inputType,
            categoryHint: dto.categoryCode ?? null,
            details,
            clarifications: [],
            codeHint: null,
            allowedCategoryCodes: CATEGORY_CODES,
          });

    const created = await this.prisma.productAnalysis.create({
      data: {
        organizationId,
        createdByUserId: userId,
        inputType,
        rawInput,
        inputKey,
        categoryHint: dto.categoryCode ?? null,
        details: details as Prisma.InputJsonValue,
        productInterestId: dto.productInterestId ?? null,
        opportunityId: dto.opportunityId ?? null,
        productId,
        ...this.resultColumns(result),
        candidates: {
          create: result.candidates.map((c, i) => ({ ...c, rank: i + 1 })),
        },
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'product.analysis_created',
      entityType: 'ProductAnalysis',
      entityId: created.id,
      metadata: {
        inputType,
        normalizedProductName: result.normalizedProductName,
        primaryCode: result.candidates[0]?.code ?? null,
        ambiguityStatus: result.ambiguityStatus,
        sourceType: result.sourceType,
        provider: result.provider,
        productInterestId: dto.productInterestId ?? null,
        opportunityId: dto.opportunityId ?? null,
        productId,
      },
    });
    return this.getById(organizationId, created.id);
  }

  /** Re-analysis of a saved product starts a new analysis linked to it; the product only changes on confirmation. */
  async analyzeForProduct(
    organizationId: string,
    userId: string,
    productId: string,
  ) {
    const product = await this.products.findOwned(organizationId, productId);
    return this.analyze(
      organizationId,
      userId,
      {
        input: product.displayName,
        inputType: 'PRODUCT_NAME',
        categoryCode: product.categoryCode ?? undefined,
        details: product.description
          ? { additionalDetails: product.description.slice(0, 1000) }
          : undefined,
      },
      product.id,
    );
  }

  // --- Clarify / re-run ------------------------------------------------

  async clarify(
    organizationId: string,
    userId: string,
    id: string,
    dto: ClarifyProductAnalysisDto,
  ) {
    const analysis = await this.findOwned(organizationId, id);
    this.assertOpen(analysis);
    const questions =
      analysis.clarifyingQuestions as unknown as ClarificationQuestion[];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const merged = new Map(
      (analysis.clarificationAnswers as unknown as ClarificationAnswer[]).map(
        (a) => [a.questionId, a],
      ),
    );
    for (const answer of dto.answers) {
      const question = byId.get(answer.questionId);
      if (!question)
        throw new BadRequestException(
          `Unknown question: ${answer.questionId}.`,
        );
      const text = answer.answer.trim();
      if (text)
        merged.set(question.id, {
          questionId: question.id,
          question: question.question,
          answer: text,
        });
    }
    const answers = [...merged.values()];
    const previousPrimary =
      analysis.candidates.find((c) => c.rank === 1)?.code ?? null;
    const result = await this.rerun(analysis, answers);
    await this.applyRerun(analysis, result, answers);

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'product.analysis_clarified',
      entityType: 'ProductAnalysis',
      entityId: id,
      metadata: {
        revision: analysis.revision + 1,
        questionIds: dto.answers.map((a) => a.questionId),
        previousPrimaryCode: previousPrimary,
        primaryCode: result.candidates[0]?.code ?? null,
        ambiguityStatus: result.ambiguityStatus,
      },
    });
    return this.getById(organizationId, id);
  }

  async reanalyze(organizationId: string, userId: string, id: string) {
    const analysis = await this.findOwned(organizationId, id);
    this.assertOpen(analysis);
    const answers =
      analysis.clarificationAnswers as unknown as ClarificationAnswer[];
    const result = await this.rerun(analysis, answers);
    await this.applyRerun(analysis, result, answers);
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'product.analysis_rerun',
      entityType: 'ProductAnalysis',
      entityId: id,
      metadata: {
        revision: analysis.revision + 1,
        primaryCode: result.candidates[0]?.code ?? null,
      },
    });
    return this.getById(organizationId, id);
  }

  private async rerun(
    analysis: AnalysisWithRelations,
    answers: ClarificationAnswer[],
  ): Promise<AnalysisResult> {
    const isCode =
      analysis.inputType === 'HS_CODE' || analysis.inputType === 'ITC_HS_CODE';
    const code = isCode ? normalizeTariffCode(analysis.rawInput) : null;
    const description = answers.find(
      (a) => a.questionId === DESCRIPTION_QUESTION_ID,
    )?.answer;
    if (code && !description) {
      return this.referenceResult(
        code,
        analysis.inputType,
        analysis.categoryHint,
      );
    }
    const result = await this.providerResult({
      input: isCode ? description! : analysis.rawInput,
      inputType: isCode ? 'DESCRIPTION' : analysis.inputType,
      categoryHint: analysis.categoryHint,
      details: analysis.details as Record<string, string>,
      clarifications: answers
        .filter((a) => a.questionId !== DESCRIPTION_QUESTION_ID)
        .map((a) => ({ question: a.question, answer: a.answer })),
      codeHint: code,
      allowedCategoryCodes: CATEGORY_CODES,
    });
    if (code && !result.candidates.some((c) => c.code === code)) {
      // Keep the code the user entered visible alongside the AI's view of it.
      const ref = await this.referenceResult(
        code,
        analysis.inputType,
        analysis.categoryHint,
      );
      result.candidates.push(ref.candidates[0]);
    }
    return result;
  }

  private async applyRerun(
    analysis: AnalysisWithRelations,
    result: AnalysisResult,
    answers: ClarificationAnswer[],
  ) {
    const manual = analysis.candidates.filter(
      (c) => c.source === 'USER_SELECTED',
    );
    await this.prisma.$transaction([
      this.prisma.productClassificationCandidate.deleteMany({
        where: { analysisId: analysis.id, source: { not: 'USER_SELECTED' } },
      }),
      this.prisma.productClassificationCandidate.updateMany({
        where: { analysisId: analysis.id },
        data: { selectedByUser: false },
      }),
      this.prisma.productAnalysis.update({
        where: { id: analysis.id },
        data: {
          ...this.resultColumns(result),
          clarificationAnswers: answers as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          generatedAt: new Date(),
          candidates: {
            create: result.candidates
              .filter(
                (c) =>
                  !manual.some(
                    (m) => m.code === c.code && m.codeSystem === c.codeSystem,
                  ),
              )
              .map((c, i) => ({ ...c, rank: i + 1 })),
          },
        },
      }),
    ]);
  }

  // --- Selection & confirmation ---------------------------------------

  async select(
    organizationId: string,
    userId: string,
    id: string,
    dto: SelectClassificationDto,
  ) {
    const analysis = await this.findOwned(organizationId, id);
    this.assertOpen(analysis);
    const candidate = await this.resolveCandidate(analysis, dto, false);
    await this.prisma.$transaction([
      this.prisma.productClassificationCandidate.updateMany({
        where: { analysisId: id },
        data: { selectedByUser: false },
      }),
      this.prisma.productClassificationCandidate.update({
        where: { id: candidate.id },
        data: { selectedByUser: true },
      }),
    ]);
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'product.classification_selected',
      entityType: 'ProductAnalysis',
      entityId: id,
      metadata: {
        code: candidate.code,
        codeSystem: candidate.codeSystem,
        source: candidate.source,
      },
    });
    return this.getById(organizationId, id);
  }

  async confirm(
    organizationId: string,
    userId: string,
    id: string,
    dto: ConfirmClassificationDto,
  ): Promise<ConfirmClassificationResponse> {
    const analysis = await this.findOwned(organizationId, id);
    this.assertOpen(analysis);
    const candidate = await this.resolveCandidate(analysis, dto, true);
    assertCategory(dto.categoryCode);

    const needsAcknowledgement = requiresLowConfidenceAck(
      candidate,
      analysis.ambiguityStatus,
    );
    if (needsAcknowledgement && !dto.acknowledgeLowConfidence) {
      throw new BadRequestException(
        'This classification has low confidence or open questions. Acknowledge this to confirm it anyway.',
      );
    }

    const displayName =
      dto.displayName?.trim() || analysis.normalizedProductName;
    let targetId: string | null = null;
    if (dto.duplicateResolution === 'UPDATE_EXISTING') {
      const existingId = dto.existingProductId ?? analysis.productId;
      if (!existingId)
        throw new BadRequestException('Choose the existing product to update.');
      targetId = (await this.products.findOwned(organizationId, existingId)).id;
    } else if (dto.duplicateResolution !== 'CREATE_NEW') {
      if (analysis.productId) {
        targetId = analysis.productId;
      } else {
        const duplicates = await this.products.findLikelyDuplicates(
          organizationId,
          displayName,
          candidate.code,
        );
        if (duplicates.length > 0) {
          throw new ConflictException({
            message: 'A similar product is already saved in your organization.',
            details: {
              duplicates: duplicates.map((d) => this.products.toSummary(d)),
            },
          });
        }
      }
    }

    const codeSystem = candidate.codeSystem as CodeSystem;
    const classification = {
      classificationCode: candidate.code,
      codeSystem,
      ...splitCode(candidate.code, codeSystem),
      classificationDescription:
        candidate.referenceDescription ?? candidate.description,
      classificationStatus: 'USER_CONFIRMED' as const,
      classificationSource: candidate.source,
      // AI confidence is kept only for AI suggestions; never attributed to user/reference codes.
      classificationConfidence:
        candidate.source === 'AI_SUGGESTED' ? candidate.confidence : null,
      lowConfidenceAcknowledged: needsAcknowledgement,
      confirmedByUserId: userId,
      confirmedAt: new Date(),
      analysisId: analysis.id,
    };

    const previous = targetId
      ? await this.prisma.organizationProduct.findUnique({
          where: { id: targetId },
        })
      : null;

    const product = await this.prisma.$transaction(async (tx) => {
      await tx.productClassificationCandidate.updateMany({
        where: { analysisId: id },
        data: { selectedByUser: false, confirmedForPlatformUse: false },
      });
      await tx.productClassificationCandidate.update({
        where: { id: candidate.id },
        data: { selectedByUser: true, confirmedForPlatformUse: true },
      });
      const saved = targetId
        ? await tx.organizationProduct.update({
            where: { id: targetId },
            data: {
              ...classification,
              ...(dto.displayName
                ? {
                    displayName,
                    normalizedName: normalizeProductName(displayName),
                  }
                : {}),
              ...(dto.description !== undefined
                ? { description: dto.description.trim() || null }
                : {}),
              ...(dto.categoryCode ? { categoryCode: dto.categoryCode } : {}),
            },
          })
        : await tx.organizationProduct.create({
            data: {
              organizationId,
              displayName,
              normalizedName: normalizeProductName(displayName),
              description: dto.description?.trim() || analysis.productSummary,
              categoryCode: dto.categoryCode ?? analysis.suggestedCategoryCode,
              createdByUserId: userId,
              ...classification,
            },
          });
      await tx.productAnalysis.update({
        where: { id },
        data: { status: 'CONFIRMED', productId: saved.id },
      });
      if (analysis.productInterestId) {
        await tx.productInterest.update({
          where: { id: analysis.productInterestId },
          data: { productId: saved.id, analyzedAt: new Date() },
        });
      }
      return saved;
    });

    const created = !targetId;
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'product.classification_confirmed',
      entityType: 'ProductAnalysis',
      entityId: id,
      metadata: {
        productId: product.id,
        code: candidate.code,
        codeSystem,
        source: candidate.source,
        confidence: classification.classificationConfidence,
        lowConfidenceAcknowledged: needsAcknowledgement,
      },
    });
    if (created) {
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: 'product.saved',
        entityType: 'OrganizationProduct',
        entityId: product.id,
        metadata: { analysisId: id, code: candidate.code },
      });
    } else if (previous && previous.classificationCode !== candidate.code) {
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: 'product.classification_changed',
        entityType: 'OrganizationProduct',
        entityId: product.id,
        metadata: {
          analysisId: id,
          from: {
            code: previous.classificationCode,
            codeSystem: previous.codeSystem,
          },
          to: { code: candidate.code, codeSystem },
          source: candidate.source,
        },
      });
    } else {
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: 'product.updated',
        entityType: 'OrganizationProduct',
        entityId: product.id,
        metadata: { analysisId: id, reconfirmed: true },
      });
    }

    return {
      product: await this.products.getById(organizationId, product.id),
      created,
    };
  }

  /** Candidate by id, a manual reference code (creates a USER_SELECTED candidate), or the current selection. */
  private async resolveCandidate(
    analysis: AnalysisWithRelations,
    dto: SelectClassificationDto,
    allowCurrentSelection: boolean,
  ): Promise<CandidateRow> {
    if (dto.candidateId) {
      const found = analysis.candidates.find((c) => c.id === dto.candidateId);
      if (!found)
        throw new NotFoundException('Candidate not found on this analysis.');
      return found;
    }
    if (dto.code) {
      if (!dto.codeSystem)
        throw new BadRequestException('Specify the code system.');
      const code = normalizeTariffCode(dto.code);
      if (!isValidCodeFormat(code, dto.codeSystem)) {
        throw new BadRequestException(
          'Invalid code format for the selected code system.',
        );
      }
      const existing = analysis.candidates.find(
        (c) => c.code === code && c.codeSystem === dto.codeSystem,
      );
      if (existing) return existing;
      const ref = await this.tariff.lookup(dto.codeSystem, code);
      if (!ref) {
        throw new NotFoundException(
          'Code not found in the reference dataset. To use an unlisted code, enter it on Analyze Product.',
        );
      }
      return this.prisma.productClassificationCandidate.create({
        data: {
          analysisId: analysis.id,
          code,
          codeSystem: dto.codeSystem,
          description: ref.description,
          confidence: null,
          rank: 100 + analysis.candidates.length,
          reasoningSummary: 'Selected manually from the tariff reference.',
          source: 'USER_SELECTED',
          inReferenceData: true,
          referenceDescription: ref.description,
        },
      });
    }
    if (allowCurrentSelection) {
      const selected = analysis.candidates.find((c) => c.selectedByUser);
      if (selected) return selected;
    }
    throw new BadRequestException('Select a classification first.');
  }

  // --- Read -----------------------------------------------------------

  async getById(
    organizationId: string,
    id: string,
  ): Promise<ProductAnalysisResponse> {
    const analysis = await this.findOwned(organizationId, id);
    const candidates = [...analysis.candidates].sort((a, b) => a.rank - b.rank);
    const selected = candidates.find((c) => c.selectedByUser) ?? null;
    const primary =
      candidates.find((c) => c.source !== 'USER_SELECTED') ?? null;

    const duplicates =
      analysis.status === 'PENDING_REVIEW'
        ? await this.products.findLikelyDuplicates(
            organizationId,
            analysis.normalizedProductName,
            (selected ?? primary)?.code ?? null,
            analysis.productId ? [analysis.productId] : [],
          )
        : [];

    const identification = analysis.identification as Record<
      string,
      string | null
    >;
    const isDev = analysis.sourceType === 'DEVELOPMENT_DEMO';
    return {
      id: analysis.id,
      inputType: analysis.inputType,
      rawInput: analysis.rawInput,
      categoryHint: analysis.categoryHint,
      details: analysis.details as ProductAnalysisDetails,
      clarificationAnswers:
        analysis.clarificationAnswers as unknown as ClarificationAnswer[],
      identification: {
        normalizedProductName: analysis.normalizedProductName,
        summary: analysis.productSummary,
        categoryCode: analysis.suggestedCategoryCode,
        material: identification.material ?? null,
        form: identification.form ?? null,
        intendedUse: identification.intendedUse ?? null,
        composition: identification.composition ?? null,
        confidence: analysis.identificationConfidence,
      },
      ambiguity: {
        status: analysis.ambiguityStatus,
        reason: analysis.ambiguityReason,
        clarifyingQuestions:
          analysis.clarifyingQuestions as unknown as ClarificationQuestion[],
      },
      candidates: candidates.map(toCandidateDto),
      primaryCandidateId: primary?.id ?? null,
      selectedCandidateId: selected?.id ?? null,
      classificationStatus:
        analysis.status === 'CONFIRMED'
          ? 'USER_CONFIRMED'
          : selected
            ? 'USER_SELECTED'
            : 'AI_SUGGESTED',
      status: analysis.status,
      revision: analysis.revision,
      provenance: {
        sourceType: analysis.sourceType,
        provider: analysis.provider,
        model: analysis.model,
        promptVersion: analysis.promptVersion,
        generatedAt: analysis.generatedAt.toISOString(),
        isDevelopmentResult: isDev,
      },
      linkedProduct: analysis.product,
      productInterestId: analysis.productInterestId,
      opportunityId: analysis.opportunityId,
      possibleDuplicates: duplicates.map((d) => this.products.toSummary(d)),
      reused: false,
      createdAt: analysis.createdAt.toISOString(),
      updatedAt: analysis.updatedAt.toISOString(),
    };
  }

  async recent(
    organizationId: string,
    limit = 8,
  ): Promise<RecentProductAnalysis[]> {
    const rows = await this.prisma.productAnalysis.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { candidates: { where: { rank: 1 }, select: { code: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      rawInput: r.rawInput,
      normalizedProductName: r.normalizedProductName,
      status: r.status,
      ambiguityStatus: r.ambiguityStatus,
      primaryCode: r.candidates[0]?.code ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async findOwned(
    organizationId: string,
    id: string,
  ): Promise<AnalysisWithRelations> {
    const row = await this.prisma.productAnalysis.findFirst({
      where: { id, organizationId },
      include: {
        candidates: true,
        product: { select: { id: true, displayName: true } },
      },
    });
    if (!row) throw new NotFoundException('Product analysis not found.');
    return row;
  }

  private assertOpen(analysis: ProductAnalysis) {
    if (analysis.status === 'CONFIRMED') {
      throw new ConflictException(
        'This analysis is already confirmed. Re-analyze from the saved product to change it.',
      );
    }
  }

  // --- Result building -------------------------------------------------

  private resultColumns(result: AnalysisResult) {
    return {
      normalizedProductName: result.normalizedProductName,
      productSummary: result.productSummary,
      suggestedCategoryCode: result.suggestedCategoryCode,
      identification: result.identification as Prisma.InputJsonValue,
      identificationConfidence: result.identificationConfidence,
      ambiguityStatus: result.ambiguityStatus,
      ambiguityReason: result.ambiguityReason,
      clarifyingQuestions:
        result.clarifyingQuestions as unknown as Prisma.InputJsonValue,
      sourceType: result.sourceType,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
    };
  }

  private async providerResult(
    request: ClassificationRequest,
  ): Promise<AnalysisResult> {
    let raw: unknown;
    try {
      raw = await this.provider.classify(request);
    } catch (error) {
      const kind =
        error instanceof ClassificationProviderError
          ? error.kind
          : 'UNEXPECTED';
      this.logger.warn(
        `Classification provider failed (${this.provider.identity.name}): ${kind}`,
      );
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }
    const parsed = classificationOutputSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `Classification provider returned invalid output (${this.provider.identity.name}): ${parsed.error.issues
          .slice(0, 3)
          .map((i) => i.path.join('.'))
          .join(', ')}`,
      );
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }
    return this.normalizeOutput(parsed.data);
  }

  /** Guardrails applied to every validated provider output before it is stored. */
  private async normalizeOutput(
    output: ClassificationOutput,
  ): Promise<AnalysisResult> {
    const seen = new Set<string>();
    const raw = [output.primaryCandidate, ...output.alternatives].filter(
      (c): c is NonNullable<typeof c> => {
        if (!c || !isValidCodeFormat(c.code, c.codeSystem) || c.code.length < 4)
          return false;
        const key = `${c.codeSystem}:${c.code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    );

    const ambiguityStatus: AmbiguityStatus = output.ambiguity.isAmbiguous
      ? 'AMBIGUOUS'
      : raw.length === 0
        ? 'INSUFFICIENT_INFORMATION'
        : 'CLEAR';
    const cap = ambiguityStatus === 'CLEAR' ? 100 : AMBIGUOUS_CONFIDENCE_CAP;
    const refs = await this.tariff.lookupMany(
      raw.map((c) => ({ codeSystem: c.codeSystem, code: c.code })),
    );

    const questionIds = new Set<string>();
    const questions: ClarificationQuestion[] =
      output.ambiguity.clarifyingQuestions
        .filter((q) => !questionIds.has(q.id) && questionIds.add(q.id))
        .map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          allowFreeText: true,
        }));

    return {
      normalizedProductName: output.normalizedProductName.trim(),
      productSummary: output.summary.trim(),
      suggestedCategoryCode: CATEGORY_CODES.includes(output.category)
        ? output.category
        : 'OTHER',
      identification: {
        material: output.identification.material,
        form: output.identification.form,
        intendedUse: output.identification.intendedUse,
        composition: output.identification.composition,
      },
      identificationConfidence: output.identification.confidence,
      ambiguityStatus,
      ambiguityReason:
        output.ambiguity.reason ??
        (ambiguityStatus === 'INSUFFICIENT_INFORMATION'
          ? 'No classification could be suggested from the information given.'
          : null),
      clarifyingQuestions: questions,
      candidates: raw.map((c) => {
        const ref = refs.get(`${c.codeSystem}:${c.code}`);
        return {
          code: c.code,
          codeSystem: c.codeSystem,
          description: c.description,
          confidence: Math.min(c.confidence, cap),
          reasoningSummary: c.reasoning || null,
          source: 'AI_SUGGESTED' as const,
          inReferenceData: Boolean(ref),
          referenceDescription: ref?.description ?? null,
        };
      }),
      sourceType: this.provider.identity.sourceType,
      provider: this.provider.identity.name,
      model: this.provider.identity.model,
      promptVersion: this.provider.identity.promptVersion,
    };
  }

  /** Code input resolved from reference data alone — no AI call. */
  private async referenceResult(
    code: string,
    inputType: ProductInputType,
    categoryHint: string | null,
  ): Promise<AnalysisResult> {
    const system: CodeSystem =
      inputType === 'ITC_HS_CODE' ? 'ITC_HS_INDIA' : 'HS';
    const ref = await this.tariff.lookup(system, code);
    const partial = system === 'HS' && code.length < 6;
    const descendants: HSReferenceItem[] =
      code.length < 8 ? await this.tariff.descendants(code) : [];
    const formatted = formatTariffCode(code);

    const entered: NormalizedCandidate = {
      code,
      codeSystem: system,
      description:
        ref?.description ??
        'Not found in the reference dataset — description unavailable.',
      confidence: null,
      reasoningSummary: ref
        ? 'Code entered by you; description from the tariff reference.'
        : 'Code entered by you; not found in the reference dataset.',
      source: 'REFERENCE_LOOKUP',
      inReferenceData: Boolean(ref),
      referenceDescription: ref?.description ?? null,
    };
    const more: NormalizedCandidate[] = descendants
      .filter((d) => (partial ? d.level <= 6 : true))
      .map((d) => ({
        code: d.code,
        codeSystem: d.codeSystem,
        description: d.description,
        confidence: null,
        reasoningSummary: `More specific ${d.codeSystem === 'ITC_HS_INDIA' ? 'ITC-HS line' : 'code'} under ${formatted}.`,
        source: 'REFERENCE_LOOKUP' as const,
        inReferenceData: true,
        referenceDescription: d.description,
      }));

    const levelName = code.length === 2 ? 'chapter' : 'heading';
    const ambiguityStatus: AmbiguityStatus = !ref
      ? 'INSUFFICIENT_INFORMATION'
      : partial
        ? 'AMBIGUOUS'
        : 'CLEAR';
    const ambiguityReason = !ref
      ? `${formatted} has a valid format but is not in the reference dataset, so its description cannot be shown. A valid format does not mean the code is correct for your product.`
      : partial
        ? `${formatted} is a ${code.length}-digit ${levelName}, not a complete classification. Choose a more specific subheading or describe the product.`
        : null;

    return {
      normalizedProductName: ref
        ? truncate(ref.description, 80)
        : `Code ${formatted}`,
      productSummary: ref
        ? `Reference description for ${formatted}: ${ref.description}`
        : `Code ${formatted} was entered directly.`,
      suggestedCategoryCode:
        categoryHint ?? CHAPTER_CATEGORY[code.slice(0, 2)] ?? 'OTHER',
      identification: {
        material: null,
        form: null,
        intendedUse: null,
        composition: null,
      },
      identificationConfidence: null,
      ambiguityStatus,
      ambiguityReason,
      clarifyingQuestions: [
        {
          id: DESCRIPTION_QUESTION_ID,
          question:
            'Describe your product (optional) to get an AI-assisted check against this code.',
          options: [],
          allowFreeText: true,
        },
      ],
      candidates: [entered, ...more],
      sourceType: 'REFERENCE_LOOKUP',
      provider: REFERENCE_PROVIDER.name,
      model: null,
      promptVersion: REFERENCE_PROVIDER.promptVersion,
    };
  }
}

function requiresLowConfidenceAck(
  candidate: CandidateRow,
  ambiguity: AmbiguityStatus,
): boolean {
  if (candidate.source === 'AI_SUGGESTED') {
    return (
      ambiguity !== 'CLEAR' ||
      (candidate.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD
    );
  }
  // User/reference codes carry no AI confidence; flag only incomplete or unverifiable codes.
  return (
    !candidate.inReferenceData ||
    (candidate.codeSystem === 'HS' && candidate.code.length < 6)
  );
}

function toCandidateDto(c: CandidateRow): ProductClassificationCandidate {
  return {
    id: c.id,
    code: c.code,
    codeSystem: c.codeSystem as CodeSystem,
    description: c.description,
    confidence: c.confidence,
    rank: c.rank,
    reasoningSummary: c.reasoningSummary,
    source: c.source,
    inReferenceData: c.inReferenceData,
    referenceDescription: c.referenceDescription,
    selectedByUser: c.selectedByUser,
    confirmedForPlatformUse: c.confirmedForPlatformUse,
  };
}

function sanitizeDetails(
  details?: ProductAnalysisDetails,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) out[key] = trimmed;
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function hashKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
