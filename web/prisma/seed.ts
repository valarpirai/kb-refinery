import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { articles, incidents, products } from "./seed/data";

const db = new PrismaClient();

/** Load each prompt markdown file into PromptTemplate, keyed by file name. */
async function seedPrompts() {
  const dir = path.join(__dirname, "seed", "prompts");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");
    const template = fs.readFileSync(path.join(dir, file), "utf8");
    await db.promptTemplate.upsert({ where: { name }, create: { name, template }, update: { template } });
  }
}

async function seedCatalog() {
  for (const i of incidents) {
    await db.incident.upsert({ where: { number: i.number }, create: i, update: i });
  }
  for (const p of products) {
    await db.product.upsert({ where: { name: p.name }, create: p, update: p });
  }
  for (const a of articles) {
    const existing = await db.article.findFirst({ where: { externalId: a.externalId, dataSourceId: null } });
    if (existing) await db.article.update({ where: { id: existing.id }, data: a });
    else await db.article.create({ data: a });
  }
}

/** Create one finished demo job so the UI has data. Skipped when any job exists. */
async function seedDemoRun() {
  if ((await db.job.count()) > 0) return;

  const byId = async (externalId: string) =>
    db.article.findFirstOrThrow({ where: { externalId, dataSourceId: null } });
  const [vpn, mfa, outlook, vpn2] = await Promise.all(
    ["KB0001", "KB0002", "KB0003", "KB0005"].map(byId),
  );

  const job = await db.job.create({
    data: {
      status: "completed", startedAt: new Date(Date.now() - 600_000), completedAt: new Date(),
      articlesTotal: 4, articlesProcessed: 4, findingsGenerated: 5, duplicatesFound: 1,
      brokenLinksFound: 1, scope: "Demo seed",
    },
  });

  const demo = [
    { a: vpn, stage: "ready" as const, raw: 41, conv: 58, enr: 86, summary: "Reset a forgotten VPN password through the self-service portal.", audience: "end_user" as const },
    { a: mfa, stage: "ready" as const, raw: 33, conv: 49, enr: 82, summary: "Enrol a phone in Okta MFA using Okta Verify.", audience: "end_user" as const },
    { a: outlook, stage: "ready" as const, raw: 52, conv: 61, enr: 79, summary: "Fix Outlook repeatedly asking for credentials.", audience: "mixed" as const },
    { a: vpn2, stage: "ready" as const, raw: 60, conv: 72, enr: 88, summary: "Reset the VPN password using the self-service portal.", audience: "end_user" as const },
  ];

  const analyses: Record<string, string> = {};
  for (const d of demo) {
    const analysis = await db.analysis.create({
      data: {
        articleId: d.a.id, pipelineStage: d.stage, standardizedSummary: d.summary,
        targetAudience: d.audience, enrichmentConfidence: "medium", lastJobId: job.id,
        searchTerms: ["vpn password", "reset", "self service"],
      },
    });
    analyses[d.a.externalId!] = analysis.id;
    await db.jobItem.create({ data: { jobId: job.id, articleId: d.a.id, analysisId: analysis.id, status: "completed" } });
    const types = [["raw", d.raw], ["converted", d.conv], ["enriched", d.enr]] as const;
    for (const [type, score] of types) {
      await db.snapshot.create({
        data: {
          analysisId: analysis.id, type, version: 1, score, llmScore: score + 3,
          content: type === "raw" ? d.a.body : `${d.a.body}\n\n<!-- ${type} placeholder -->`,
          wordCount: d.a.body.split(/\s+/).length, processedAt: new Date(), lastJobId: job.id,
        },
      });
    }
  }

  const f1 = await db.finding.create({
    data: { analysisId: analyses.KB0001, type: "duplicate", severity: "high", relatedAnalysisId: analyses.KB0005,
      recommendedPrimaryId: analyses.KB0005, detail: "Covers the same VPN reset steps as KB0005.", lastJobId: job.id },
  });
  await db.finding.create({
    data: { analysisId: analyses.KB0001, type: "audience_mismatch", severity: "low",
      detail: "Opens with a bare pronoun and refers to a 'previous article'.", lastJobId: job.id },
  });
  await db.finding.create({
    data: { analysisId: analyses.KB0002, type: "broken_link", severity: "medium", brokenUrl: "https://example.com/old-mfa-page",
      detail: "Link text is 'click here' and the target is dead.", lastJobId: job.id },
  });
  await db.finding.create({
    data: { analysisId: analyses.KB0002, type: "image_dependent", severity: "high",
      detail: "The QR step relies on a screenshot with no alt text.", lastJobId: job.id },
  });
  const f5 = await db.finding.create({
    data: { analysisId: analyses.KB0003, type: "incomplete", severity: "medium",
      detail: "Does not mention token refresh after an MFA change.", lastJobId: job.id },
  });

  const inc = async (number: string) => db.incident.findUniqueOrThrow({ where: { number } });
  await db.evidence.create({ data: { findingId: f5.id, incidentId: (await inc("INC0010006")).id,
    newInformation: "Signing out of all Office apps refreshes an invalid token.", contradictsArticle: false } });
  await db.evidence.create({ data: { findingId: f1.id, incidentId: (await inc("INC0010002")).id,
    newInformation: "Reset works off-network through the public portal.", contradictsArticle: true } });

  const mentions: Array<[string, string, number]> = [
    ["KB0001", "VPN", 3], ["KB0001", "Self-service portal", 1], ["KB0005", "VPN", 3],
    ["KB0005", "Self-service portal", 2], ["KB0002", "Okta", 4], ["KB0003", "Outlook", 3],
    ["KB0003", "Windows", 1],
  ];
  for (const [ext, name, count] of mentions) {
    const product = await db.product.findUniqueOrThrow({ where: { name } });
    await db.mention.create({ data: { analysisId: analyses[ext], productId: product.id, mentionCount: count } });
  }
  for (const p of await db.product.findMany()) {
    await db.product.update({ where: { id: p.id }, data: { articleCount: await db.mention.count({ where: { productId: p.id } }) } });
  }
}

async function main() {
  await seedPrompts();
  await seedCatalog();
  await seedDemoRun();
  console.log("Seed complete");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
