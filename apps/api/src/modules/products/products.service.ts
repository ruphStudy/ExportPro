import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationProduct, Prisma } from '@prisma/client';
import {
  CodeSystem,
  isValidCodeFormat,
  normalizeTariffCode,
  PRODUCT_CATEGORIES,
  ProductDetail,
  ProductSummary,
} from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  buildPaginationMeta,
  toSkipTake,
} from '../../common/utils/pagination.util';
import { TariffReferenceService } from '../product-analysis/reference/tariff-reference.service';
import { ChangeClassificationDto, UpdateProductDto } from './dto/product.dto';

const STOPWORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'made',
  'of',
  'other',
]);

export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)),
  );
}

/** Overlap coefficient: |A∩B| / min(|A|,|B|). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export function assertCategory(code: string | null | undefined) {
  if (code && !PRODUCT_CATEGORIES.some((c) => c.code === code)) {
    throw new BadRequestException('Unknown product category.');
  }
}

export function splitCode(code: string, codeSystem: CodeSystem) {
  return codeSystem === 'ITC_HS_INDIA'
    ? { hsCode: code.slice(0, 6), itcHsCode: code }
    : { hsCode: code, itcHsCode: null };
}

type ProductWithRelations = OrganizationProduct & {
  confirmedBy?: { id: string; firstName: string; lastName: string } | null;
  productInterests?: { id: string; name: string }[];
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tariff: TariffReferenceService,
  ) {}

  toSummary(row: OrganizationProduct): ProductSummary {
    return {
      id: row.id,
      displayName: row.displayName,
      description: row.description,
      categoryCode: row.categoryCode,
      classificationCode: row.classificationCode,
      codeSystem: row.codeSystem as CodeSystem,
      hsCode: row.hsCode,
      itcHsCode: row.itcHsCode,
      classificationDescription: row.classificationDescription,
      classificationStatus: row.classificationStatus,
      classificationSource: row.classificationSource,
      classificationConfidence: row.classificationConfidence,
      lowConfidenceAcknowledged: row.lowConfidenceAcknowledged,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async toDetail(row: ProductWithRelations): Promise<ProductDetail> {
    const interest = row.productInterests?.[0] ?? null;
    return {
      ...this.toSummary(row),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      confirmedBy: row.confirmedBy
        ? {
            id: row.confirmedBy.id,
            name: `${row.confirmedBy.firstName} ${row.confirmedBy.lastName}`.trim(),
          }
        : null,
      analysisId: row.analysisId,
      productInterest: interest
        ? { id: interest.id, name: interest.name }
        : null,
      marketAnalysis: await this.marketAnalysisPathway(row),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private readonly detailInclude = {
    confirmedBy: { select: { id: true, firstName: true, lastName: true } },
    productInterests: { select: { id: true, name: true }, take: 1 },
  } satisfies Prisma.OrganizationProductInclude;

  async findOwned(organizationId: string, id: string) {
    const row = await this.prisma.organizationProduct.findFirst({
      where: { id, organizationId },
      include: this.detailInclude,
    });
    // 404 (not 403) for other orgs' ids so existence isn't leaked across tenants.
    if (!row) throw new NotFoundException('Product not found.');
    return row;
  }

  async list(
    organizationId: string,
    q: string | undefined,
    page = 1,
    pageSize = 20,
  ) {
    const where: Prisma.OrganizationProductWhereInput = { organizationId };
    const term = q?.trim();
    if (term) {
      const digits = normalizeTariffCode(term);
      where.OR = [
        { displayName: { contains: term, mode: 'insensitive' } },
        ...(/^\d+$/.test(digits)
          ? [{ classificationCode: { startsWith: digits } }]
          : []),
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.organizationProduct.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...toSkipTake(page, pageSize),
      }),
      this.prisma.organizationProduct.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toSummary(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getById(organizationId: string, id: string): Promise<ProductDetail> {
    return this.toDetail(await this.findOwned(organizationId, id));
  }

  /**
   * Same normalized name, or same exact code AND a similar name. Sharing
   * only a broad heading is never treated as a duplicate.
   */
  async findLikelyDuplicates(
    organizationId: string,
    name: string,
    code: string | null,
    excludeIds: string[] = [],
  ): Promise<OrganizationProduct[]> {
    const normalized = normalizeProductName(name);
    const rows = await this.prisma.organizationProduct.findMany({
      where: {
        organizationId,
        id: { notIn: excludeIds },
        OR: [
          { normalizedName: normalized },
          ...(code ? [{ classificationCode: code }] : []),
        ],
      },
      take: 10,
    });
    return rows
      .filter(
        (r) =>
          r.normalizedName === normalized ||
          nameSimilarity(r.displayName, name) >= 0.5,
      )
      .slice(0, 5);
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: UpdateProductDto,
  ) {
    const existing = await this.findOwned(organizationId, id);
    assertCategory(dto.categoryCode);
    const data: Prisma.OrganizationProductUpdateInput = {};
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName.trim();
      data.normalizedName = normalizeProductName(dto.displayName);
    }
    if (dto.description !== undefined)
      data.description = dto.description?.trim() || null;
    if (dto.categoryCode !== undefined) data.categoryCode = dto.categoryCode;

    const row = await this.prisma.organizationProduct.update({
      where: { id: existing.id },
      data,
      include: this.detailInclude,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'product.updated',
      entityType: 'OrganizationProduct',
      entityId: id,
      metadata: { fields: Object.keys(data) },
    });
    return this.toDetail(row);
  }

  /** Manual re-classification from reference search — always USER_SELECTED, never with an AI confidence. */
  async changeClassification(
    organizationId: string,
    actorId: string,
    id: string,
    dto: ChangeClassificationDto,
  ) {
    const existing = await this.findOwned(organizationId, id);
    const code = normalizeTariffCode(dto.code);
    if (!isValidCodeFormat(code, dto.codeSystem)) {
      throw new BadRequestException(
        'Invalid code format for the selected code system.',
      );
    }
    const ref = await this.tariff.lookup(dto.codeSystem, code);
    if (!ref)
      throw new NotFoundException('Code not found in the reference dataset.');

    const row = await this.prisma.organizationProduct.update({
      where: { id: existing.id },
      data: {
        classificationCode: code,
        codeSystem: dto.codeSystem,
        ...splitCode(code, dto.codeSystem),
        classificationDescription: ref.description,
        classificationStatus: 'USER_CONFIRMED',
        classificationSource: 'USER_SELECTED',
        classificationConfidence: null,
        lowConfidenceAcknowledged: code.length < 6,
        confirmedByUserId: actorId,
        confirmedAt: new Date(),
      },
      include: this.detailInclude,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'product.classification_changed',
      entityType: 'OrganizationProduct',
      entityId: id,
      metadata: {
        from: {
          code: existing.classificationCode,
          codeSystem: existing.codeSystem,
        },
        to: { code, codeSystem: dto.codeSystem },
        source: 'USER_SELECTED',
      },
    });
    return this.toDetail(row);
  }

  /**
   * Honest bridge to the existing opportunity discovery (full country
   * analysis is a later sprint): match by name within the category, else
   * fall back to the category alone.
   */
  private async marketAnalysisPathway(row: OrganizationProduct) {
    const candidates = await this.prisma.opportunity.groupBy({
      by: ['productName'],
      where: row.categoryCode ? { productCategoryCode: row.categoryCode } : {},
      _count: { _all: true },
    });
    let best: { name: string; count: number; score: number } | null = null;
    for (const c of candidates) {
      const score = nameSimilarity(c.productName, row.displayName);
      if (score > 0.5 && (!best || score > best.score)) {
        best = { name: c.productName, count: c._count._all, score };
      }
    }
    const categoryCount = row.categoryCode
      ? candidates.reduce((sum, c) => sum + c._count._all, 0)
      : 0;
    return {
      opportunitySearch: best?.name ?? null,
      categoryCode: row.categoryCode,
      matchingOpportunityCount: best ? best.count : categoryCount,
    };
  }
}
