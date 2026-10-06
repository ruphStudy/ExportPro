/**
 * Idempotent demo-data seed for Sprint 4. Safe to re-run: opportunities
 * are upserted by (productName, destinationCountryCode), and only the
 * current snapshot is refreshed — the original "previous" snapshot (used
 * for the score-delta demo) is created once and left alone.
 *
 * Run with: npm run seed:opportunities --workspace apps/api
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { DemoOpportunityProvider } from "../src/modules/opportunities/providers/demo-opportunity.provider";
import { ScoringService } from "../src/modules/opportunities/scoring.service";

async function main() {
  const prisma = new PrismaClient();
  const provider = new DemoOpportunityProvider();
  const scoring = new ScoringService();

  const candidates = provider.generate();
  console.log(`Seeding ${candidates.length} demo opportunities...`);

  let created = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const components = scoring.computeComponents(candidate.raw);
    const overallScore = scoring.computeOverallScore(components);
    const key = `${candidate.productName}|${candidate.destinationCountryCode}`;
    const confidence = scoring.computeConfidence(candidate.freshnessStatus, key);

    const data = {
      productName: candidate.productName,
      productCategoryCode: candidate.productCategoryCode,
      destinationCountryCode: candidate.destinationCountryCode,
      overallScore,
      demandScore: components.demand,
      indiaExportScore: components.indiaExports,
      growthScore: components.growth,
      competitionScore: components.competition,
      complianceScore: components.compliance,
      logisticsScore: components.logistics,
      marginScore: components.margin,
      seasonalityScore: components.seasonality,
      marketDiversityScore: components.marketDiversity,
      confidenceScore: confidence,
      competitionLevel: scoring.competitionLevel(components.competition),
      complianceDifficulty: scoring.complianceDifficulty(components.compliance),
      seasonalityLevel: scoring.seasonalityLevel(components.seasonality),
      investmentRange: candidate.investmentRange,
      sourceType: candidate.sourceType,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      sourceDate: candidate.sourceDate,
      freshnessStatus: candidate.freshnessStatus,
    };

    const existing = await prisma.opportunity.findUnique({
      where: { productName_destinationCountryCode: { productName: candidate.productName, destinationCountryCode: candidate.destinationCountryCode } },
    });

    const opportunity = await prisma.opportunity.upsert({
      where: { productName_destinationCountryCode: { productName: candidate.productName, destinationCountryCode: candidate.destinationCountryCode } },
      create: data,
      update: data,
    });

    if (existing) updated += 1;
    else created += 1;

    // Seed a slightly different "previous" snapshot once, so the UI has
    // something to compute a delta against on first load. Captured
    // first (chronologically earlier) only when this opportunity has no
    // history yet.
    const snapshotCount = await prisma.opportunityScoreSnapshot.count({ where: { opportunityId: opportunity.id } });
    if (snapshotCount === 0) {
      const driftedComponents = { ...components };
      const driftKeys = Object.keys(driftedComponents) as (keyof typeof driftedComponents)[];
      const driftKey = driftKeys[Math.abs(overallScore + candidate.destinationCountryCode.length) % driftKeys.length];
      driftedComponents[driftKey] = Math.max(0, Math.min(100, driftedComponents[driftKey] - 6));
      const previousOverall = scoring.computeOverallScore(driftedComponents);

      await prisma.opportunityScoreSnapshot.create({
        data: {
          opportunityId: opportunity.id,
          overallScore: previousOverall,
          components: driftedComponents as unknown as Prisma.InputJsonValue,
          confidence: Math.max(0, confidence - 4),
          capturedAt: new Date(candidate.sourceDate.getTime() - 14 * 24 * 60 * 60 * 1000),
        },
      });
    }

    await prisma.opportunityScoreSnapshot.create({
      data: {
        opportunityId: opportunity.id,
        overallScore,
        components: components as unknown as Prisma.InputJsonValue,
        confidence,
        capturedAt: new Date(),
      },
    });
  }

  console.log(`Done. Created ${created}, updated ${updated}, total ${candidates.length}.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
