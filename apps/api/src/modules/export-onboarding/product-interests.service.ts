import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductInterest } from '@prisma/client';
import { ProductInterestSummary } from '@exportpro/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateProductInterestDto,
  UpdateProductInterestDto,
} from './dto/product-interest.dto';

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

@Injectable()
export class ProductInterestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  toSummary(row: ProductInterest): ProductInterestSummary {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      interestType: row.interestType as ProductInterestSummary['interestType'],
      notes: row.notes,
      productId: row.productId,
      analyzedAt: row.analyzedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(organizationId: string): Promise<ProductInterestSummary[]> {
    const rows = await this.prisma.productInterest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: CreateProductInterestDto,
  ): Promise<ProductInterestSummary> {
    const normalized = normalizeName(dto.name);
    // Deduplicate obvious duplicates case-insensitively without a DB-level
    // unique constraint (names are free text, so near-duplicates are fine).
    const duplicate = await this.prisma.productInterest.findFirst({
      where: {
        organizationId,
        name: { equals: dto.name, mode: 'insensitive' },
      },
    });
    if (duplicate) return this.toSummary(duplicate);

    const row = await this.prisma.productInterest.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        category: dto.category,
        interestType: dto.interestType ?? 'INTERESTED',
        notes: dto.notes,
      },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.product_interest_added',
      entityType: 'ProductInterest',
      entityId: row.id,
      metadata: { name: normalized },
    });
    return this.toSummary(row);
  }

  private async findOwned(
    organizationId: string,
    id: string,
  ): Promise<ProductInterest> {
    const row = await this.prisma.productInterest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Product interest not found.');
    if (row.organizationId !== organizationId)
      throw new ForbiddenException('Not found in this organization.');
    return row;
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: UpdateProductInterestDto,
  ): Promise<ProductInterestSummary> {
    await this.findOwned(organizationId, id);
    const row = await this.prisma.productInterest.update({
      where: { id },
      data: dto,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.product_interest_updated',
      entityType: 'ProductInterest',
      entityId: id,
    });
    return this.toSummary(row);
  }

  async remove(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.findOwned(organizationId, id);
    await this.prisma.productInterest.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'onboarding.product_interest_removed',
      entityType: 'ProductInterest',
      entityId: id,
    });
    return { message: 'Product interest removed.' };
  }
}
