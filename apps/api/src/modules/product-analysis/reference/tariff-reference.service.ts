import { Injectable } from '@nestjs/common';
import { Prisma, TariffCode } from '@prisma/client';
import {
  CodeSystem,
  HSReferenceItem,
  normalizeTariffCode,
} from '@exportpro/types';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginationMeta,
  toSkipTake,
} from '../../../common/utils/pagination.util';

/**
 * Read-only access to the tariff reference table. Never calls the AI
 * provider — code/description search is a plain database query.
 */
@Injectable()
export class TariffReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  toItem(row: TariffCode): HSReferenceItem {
    return {
      code: row.code,
      codeSystem: row.codeSystem as CodeSystem,
      level: row.level,
      description: row.description,
      parentCode: row.parentCode,
      sourceType: row.sourceType,
      sourceName: row.sourceName,
    };
  }

  async search(
    q: string,
    codeSystem: CodeSystem | undefined,
    page = 1,
    pageSize = 20,
  ) {
    const term = q.trim();
    const digits = normalizeTariffCode(term);
    const where: Prisma.TariffCodeWhereInput = { isActive: true };
    if (codeSystem) where.codeSystem = codeSystem;
    if (/^\d+$/.test(digits)) {
      where.code = { startsWith: digits };
    } else {
      const tokens = term
        .split(/\s+/)
        .filter((t) => t.length >= 2)
        .slice(0, 6);
      where.AND = tokens.map((t) => ({
        description: { contains: t, mode: 'insensitive' },
      }));
    }
    const [rows, total] = await Promise.all([
      this.prisma.tariffCode.findMany({
        where,
        orderBy: [{ code: 'asc' }, { codeSystem: 'asc' }],
        ...toSkipTake(page, pageSize),
      }),
      this.prisma.tariffCode.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toItem(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async lookup(
    codeSystem: CodeSystem,
    code: string,
  ): Promise<HSReferenceItem | null> {
    const row = await this.prisma.tariffCode.findUnique({
      where: { codeSystem_code: { codeSystem, code } },
    });
    return row && row.isActive ? this.toItem(row) : null;
  }

  /** Map keyed by `${codeSystem}:${code}`. */
  async lookupMany(entries: { codeSystem: CodeSystem; code: string }[]) {
    if (entries.length === 0) return new Map<string, HSReferenceItem>();
    const rows = await this.prisma.tariffCode.findMany({
      where: {
        OR: entries.map((e) => ({ codeSystem: e.codeSystem, code: e.code })),
        isActive: true,
      },
    });
    return new Map(
      rows.map((r) => [`${r.codeSystem}:${r.code}`, this.toItem(r)]),
    );
  }

  /** More specific codes under a heading/subheading, including ITC-HS lines under a 6-digit HS code. */
  async descendants(code: string, limit = 12): Promise<HSReferenceItem[]> {
    const rows = await this.prisma.tariffCode.findMany({
      where: { code: { startsWith: code, not: code }, isActive: true },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      take: limit,
    });
    return rows.map((r) => this.toItem(r));
  }
}
