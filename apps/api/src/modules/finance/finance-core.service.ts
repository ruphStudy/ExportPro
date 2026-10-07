import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { roleHasPermission, type FxBasis } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../commercial/commercial-core.service';
import { D, type Dec } from '../costing/costing-calculator';
import { addDays, isoDay, utcDay } from './finance-rules';

export type Perm = Parameters<typeof roleHasPermission>[1];

/** Settings, permissions, FX lookup and date ranges shared by the finance services. */
@Injectable()
export class FinanceCoreService {
  constructor(private readonly prisma: PrismaService) {}

  can(a: Actor, p: Perm) {
    return roleHasPermission(a.role, p);
  }
  need(a: Actor, p: Perm) {
    if (!this.can(a, p))
      throw new ForbiddenException(`Missing required permission: ${p}`);
  }

  async settings(org: string) {
    const s = await this.prisma.financeSettings.findUnique({
      where: { organizationId: org },
    });
    return {
      reportingCurrency: s?.reportingCurrency ?? 'INR',
      dueSoonDays: s?.dueSoonDays ?? 7,
      reorderLeadDays: s?.reorderLeadDays ?? 7,
    };
  }

  async updateSettings(
    a: Actor,
    dto: {
      reportingCurrency?: string;
      dueSoonDays?: number;
      reorderLeadDays?: number;
    },
  ) {
    await this.prisma.financeSettings.upsert({
      where: { organizationId: a.organizationId },
      create: {
        organizationId: a.organizationId,
        ...dto,
        updatedByUserId: a.userId,
      },
      update: { ...dto, updatedByUserId: a.userId },
    });
    return this.settings(a.organizationId);
  }

  /**
   * Latest saved FX snapshot (Sprint 14 infrastructure), direct or inverse.
   * Returns null when none exists — never an invented rate.
   */
  async latestRate(
    org: string,
    from: string,
    to: string,
  ): Promise<{ rate: Dec; basis: FxBasis } | null> {
    if (from === to)
      return {
        rate: new D(1),
        basis: {
          rate: '1',
          from,
          to,
          sourceLabel: 'Same currency',
          sourceDate: null,
          snapshotId: null,
        },
      };
    const direct = await this.prisma.fxRateSnapshot.findFirst({
      where: { organizationId: org, baseCurrency: from, quoteCurrency: to },
      orderBy: { capturedAt: 'desc' },
    });
    const inverse = direct
      ? null
      : await this.prisma.fxRateSnapshot.findFirst({
          where: { organizationId: org, baseCurrency: to, quoteCurrency: from },
          orderBy: { capturedAt: 'desc' },
        });
    const s = direct ?? inverse;
    if (!s) return null;
    const rate = direct
      ? new D(s.rate.toString())
      : new D(1).div(s.rate.toString()).toDecimalPlaces(10);
    return {
      rate,
      basis: {
        rate: rate.toString(),
        from,
        to,
        sourceLabel: `${s.sourceLabel ?? s.sourceType}${direct ? '' : ' (inverse)'}`,
        sourceDate: isoDay(s.sourceDate),
        snapshotId: s.id,
      },
    };
  }

  /** Explicit user-entered rate (1 from = rate × to). */
  explicit(
    from: string,
    to: string,
    fx: { rate: string; sourceLabel?: string; sourceDate?: string },
  ): { rate: Dec; basis: FxBasis } {
    const rate = new D(fx.rate);
    if (rate.lte(0))
      throw new BadRequestException('Exchange rate must be positive.');
    return {
      rate,
      basis: {
        rate: rate.toString(),
        from,
        to,
        sourceLabel: fx.sourceLabel?.trim() || 'Entered manually',
        sourceDate: fx.sourceDate
          ? fx.sourceDate.slice(0, 10)
          : isoDay(new Date()),
        snapshotId: null,
      },
    };
  }

  range(q: { range?: string; from?: string; to?: string }, now = new Date()) {
    const today = new Date(utcDay(now));
    if (q.range === 'custom' || q.from || q.to) {
      const from = q.from ? new Date(q.from) : new Date(Date.UTC(2000, 0, 1));
      const to = q.to ? new Date(q.to) : today;
      if (from > to)
        throw new BadRequestException(
          'The start date must be before the end date.',
        );
      return {
        from,
        to: addDays(to, 1),
        label: { from: isoDay(from)!, to: isoDay(to)! },
      };
    }
    let from: Date;
    switch (q.range) {
      case '30d':
        from = addDays(today, -29);
        break;
      case 'quarter':
        from = new Date(
          Date.UTC(
            today.getUTCFullYear(),
            Math.floor(today.getUTCMonth() / 3) * 3,
            1,
          ),
        );
        break;
      case 'year':
        from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
        break;
      case 'all':
        from = new Date(Date.UTC(2000, 0, 1));
        break;
      default:
        from = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
        );
    }
    return {
      from,
      to: addDays(today, 1),
      label: { from: isoDay(from)!, to: isoDay(today)! },
    };
  }
}
