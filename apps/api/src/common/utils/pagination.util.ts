import { PaginationMeta } from '@exportpro/types';

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export function toSkipTake(page = 1, pageSize = 20) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
