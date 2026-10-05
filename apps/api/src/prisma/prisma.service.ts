import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Deliberately does NOT $connect() in onModuleInit. Prisma connects
 * lazily on first query, so the app (and `npm run build` / `nest start`)
 * must boot even with no database reachable yet — only requests that
 * actually touch the DB should fail until DATABASE_URL points somewhere real.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleDestroy() {
    await this.$disconnect().catch((error) => {
      this.logger.warn(
        `Error during Prisma disconnect: ${error instanceof Error ? error.message : error}`,
      );
    });
  }
}
