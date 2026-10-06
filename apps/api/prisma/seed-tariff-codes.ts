/**
 * Idempotent seed for the Sprint 5 DEVELOPMENT_SAMPLE tariff reference.
 * Upserts by (codeSystem, code); never overwrites rows whose sourceType is
 * OFFICIAL, so it is safe to re-run after an official import.
 *
 * Run with: npm run seed:tariff-codes --workspace apps/api
 */
import { PrismaClient } from "@prisma/client";
import {
  DEVELOPMENT_TARIFF_CODES,
  DEVELOPMENT_TARIFF_SOURCE_NAME,
  parentCodeOf,
} from "../src/modules/product-analysis/reference/development-tariff-codes";

async function main() {
  const prisma = new PrismaClient();
  let written = 0;
  for (const row of DEVELOPMENT_TARIFF_CODES) {
    const existing = await prisma.tariffCode.findUnique({
      where: { codeSystem_code: { codeSystem: row.codeSystem, code: row.code } },
    });
    if (existing?.sourceType === "OFFICIAL") continue;
    const data = {
      level: row.code.length,
      description: row.description,
      parentCode: parentCodeOf(row.code),
      sourceType: "DEVELOPMENT_SAMPLE" as const,
      sourceName: DEVELOPMENT_TARIFF_SOURCE_NAME,
      isActive: true,
    };
    await prisma.tariffCode.upsert({
      where: { codeSystem_code: { codeSystem: row.codeSystem, code: row.code } },
      create: { codeSystem: row.codeSystem, code: row.code, ...data },
      update: data,
    });
    written++;
  }
  console.log(`Done. Upserted ${written} development tariff codes.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
